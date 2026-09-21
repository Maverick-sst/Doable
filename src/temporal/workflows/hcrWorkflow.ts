import * as wf from "@temporalio/workflow";
import type { NodeType } from "@prisma/client";
import type {
  TemporalHcrWorkflowInput,
  TemporalHcrResult,
} from "../contracts/hcr";
import type { DoableIdentity } from "../contracts/types";

// Validation is a short read-only DB check; node execution performs
// embeddings + LLM attempts + artifact/file writes and needs minutes.
// Separate proxies keep each timeout/retry policy explicit and conservative.
const { validateHcrContext } = wf.proxyActivities<
  typeof import("../activities/hcrActivities")
>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});

// Structured nodes get room for slow-provider LLM calls (a ~5-minute call
// falsely timed out in production once). Retrying stays safe for product
// state because the adapter reuses the artifact by nodeId; see
// runHcrNodeActivity docs for the known duplicate-event limitation.
// Heartbeats (30s interval, 120s timeout) renew the lease while the provider
// is slow-but-alive, so only genuinely dead workers time out. Parity on
// retry count with the Inngest node `retries:3` is unchanged.
const { runHcrNodeActivity } = wf.proxyActivities<
  typeof import("../activities/hcrActivities")
>({
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "2 minutes",
  retry: { maximumAttempts: 3 },
});

// Tool-call nodes (FRONTEND_ENG / BACKEND_ENG) loop up to 20 agentic
// iterations with file I/O; they keep the longer budget. Same activity,
// same retry parity — only the timeout differs. Heartbeats as above.
const { runHcrNodeActivity: runHcrToolNode } = wf.proxyActivities<
  typeof import("../activities/hcrActivities")
>({
  startToCloseTimeout: "15 minutes",
  heartbeatTimeout: "2 minutes",
  retry: { maximumAttempts: 3 },
});

// Coordinator port + finalize port: short DB-only steps.
const { createNextHcrNodes, finalizeHcrSlice } = wf.proxyActivities<
  typeof import("../activities/hcrActivities")
>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});

// Short, non-retried compensation: it only runs after a node activity has
// exhausted its own retries, and its writes are idempotent (conditional
// updateMany), so a single attempt suffices.
const { markHcrFailed } = wf.proxyActivities<
  typeof import("../activities/hcrActivities")
>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 1 },
});

// Tool-call node names without a runtime import: workflow bundles must stay
// free of Node-runtime values (`@prisma/client` values would poison the
// deterministic bundle), so the enum members are spelled as literals and
// asserted to the (type-only, erased) NodeType. Prisma string enums
// serialize to exactly these values.
const TOOL_CALL_NODES: NodeType[] = ["FRONTEND_ENG", "BACKEND_ENG"] as NodeType[];

interface PendingNode {
  identity: DoableIdentity;
  nodeType: NodeType;
  prompt: string;
  inputArtifactId: string | null;
}

/**
 * Full HCR graph through Temporal:
 * validate → run pending nodes (concurrently on fan-out) → coordinate →
 * repeat until finalize.
 *
 * Mirrors the Inngest graph exactly (`HCR_TRANSITION_MAP`: ARCHITECT →
 * RESEARCH → PRD_REVIEWER → PLANNER → FRONTEND_ENG + BACKEND_ENG in parallel
 * → finalize). The workflow stops issuing work only when the coordinator
 * port says `finalize` (then one guarded finalize call) or `wait` (a peer
 * still running — unreachable in this joined loop, kept for parity).
 *
 * Failure parity with Inngest (`onFailure → handleFailure`): when node
 * activities exhaust their retries, each failed node is compensated with
 * its OWN identity via `markHcrFailed` (a prior version compensated the
 * trigger node instead — mis-marking ARCHITECT for a PLANNER failure), then
 * the first error rethrows so the Temporal run also shows failed.
 * Validation failures skip compensation — nothing ran yet.
 *
 * Batch semantics: a batch settles fully before coordinating, so a sibling
 * failure can never strand or mis-attribute a peer. A still-running sibling
 * is awaited (bounded by its own timeout); orphaned worker-side writes past
 * lease expiry remain a parked caveat.
 *
 * Postgres remains the product source of truth; Temporal only decides WHEN
 * each Activity runs and survives worker restarts between them.
 */
export async function hcrWorkflow(
  input: TemporalHcrWorkflowInput,
): Promise<TemporalHcrResult> {
  const validated = await validateHcrContext({ identity: input.identity });

  const baseIdentity = input.identity;
  let pending: PendingNode[] = [
    {
      identity: baseIdentity,
      nodeType: validated.nodeType,
      prompt: input.prompt,
      inputArtifactId: input.inputArtifactId ?? null,
    },
  ];

  const nodesCompleted: string[] = [];
  const artifacts: Array<{
    nodeType: string;
    artifactId: string | null;
    artifactType: string | null;
  }> = [];
  let lastNodeId = validated.doableNodeId;
  let lastArtifactId: string | null = null;
  let lastArtifactType: string | null = null;
  let lastNodeType = validated.nodeType;

  try {
    while (pending.length > 0) {
      // Settle-and-attribute: every node outcome carries its own identity,
      // so compensation can never mark the wrong node (previously the catch
      // below compensated `baseIdentity` — the trigger node — for any
      // failure anywhere in the graph).
      const settled = await Promise.all(
        pending.map(async (node) => {
          try {
            const result = await (TOOL_CALL_NODES.includes(node.nodeType)
              ? runHcrToolNode
              : runHcrNodeActivity)({
              identity: node.identity,
              nodeType: node.nodeType,
              prompt: node.prompt,
              inputArtifactId: node.inputArtifactId,
            });
            return { ok: true as const, node, result };
          } catch (error) {
            return { ok: false as const, node, error };
          }
        }),
      );

      const failures = settled.filter(
        (entry): entry is Extract<typeof entry, { ok: false }> => !entry.ok,
      );
      if (failures.length > 0) {
        for (const failure of failures) {
          const reason =
            failure.error instanceof Error
              ? failure.error.message
              : String(failure.error);
          await markHcrFailed({
            identity: failure.node.identity,
            reason,
          });
        }
        throw failures[0].error;
      }

      const results = settled
        .filter(
          (entry): entry is Extract<typeof entry, { ok: true }> => entry.ok,
        )
        .map((entry) => entry.result);

      const nextPending: PendingNode[] = [];
      let finalizeRequested = false;

      for (const result of results) {
        nodesCompleted.push(result.nodeType);
        artifacts.push({
          nodeType: result.nodeType,
          artifactId: result.artifactId,
          artifactType: result.artifactType,
        });
        lastNodeId = result.doableNodeId;
        lastArtifactId = result.artifactId;
        lastArtifactType = result.artifactType;
        lastNodeType = result.nodeType;

        const decision = await createNextHcrNodes({
          identity: {
            ...baseIdentity,
            nodeId: result.doableNodeId,
          },
          prompt: input.prompt,
          outputArtifactId: result.artifactId,
          outputArtifactType: result.artifactType,
        });

        if (decision.action === "spawn") {
          for (const spawned of decision.nextNodes) {
            nextPending.push({
              identity: { ...baseIdentity, nodeId: spawned.nodeId },
              nodeType: spawned.nodeType,
              prompt: input.prompt,
              inputArtifactId: spawned.inputArtifactId,
            });
          }
        } else if (decision.action === "finalize") {
          finalizeRequested = true;
        }
        // `wait`: a parallel peer still running — unreachable here because
        // the batch joins all spawned nodes before coordinating. Ignored.
      }

      if (nextPending.length > 0) {
        pending = nextPending;
      } else {
        if (finalizeRequested) {
          await finalizeHcrSlice({ identity: baseIdentity });
        }
        pending = [];
      }
    }
  } catch (error) {
    // Reachable only for non-node failures (validation already returned
    // above; coordinator/finalize failures land here): compensate the
    // trigger node as a last resort so the run never fails silently.
    const reason = error instanceof Error ? error.message : String(error);
    await markHcrFailed({ identity: baseIdentity, reason });
    throw error;
  }

  return {
    doableProjectId: validated.doableProjectId,
    doableWorkflowId: validated.doableWorkflowId,
    doableExecutionId: validated.doableExecutionId,
    doableNodeId: lastNodeId,
    executionStatus: validated.executionStatus,
    nodeMigrated: true,
    temporalWorkflowId: wf.workflowInfo().workflowId,
    artifactId: lastArtifactId,
    artifactType: lastArtifactType,
    nodeType: lastNodeType,
    nodesCompleted,
    artifacts,
  };
}
