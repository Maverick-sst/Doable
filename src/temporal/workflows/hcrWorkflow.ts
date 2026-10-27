import * as wf from "@temporalio/workflow";
import type { NodeType } from "@prisma/client";
import type {
  TemporalHcrWorkflowInput,
  TemporalHcrResult,
} from "../contracts/hcr";
import type { DoableIdentity } from "../contracts/types";
import type { VerificationWorkflowInput } from "../contracts/verification";
import { verificationWorkflow } from "./verificationWorkflow";
import {
  DATABASE_ACTIVITY_TIMEOUT,
  HEARTBEAT_TIMEOUT,
  NODE_ACTIVITY_ATTEMPTS,
  NODE_SCHEDULE_TO_CLOSE_TIMEOUT,
  REPAIR_MAX_ATTEMPTS,
  STRUCTURED_NODE_ACTIVITY_TIMEOUT,
  TOOL_NODE_ACTIVITY_TIMEOUT,
  VERIFICATION_WORKFLOW_TIMEOUT,
} from "../workflow-timeouts";

// Validation is a short read-only DB check; node execution performs
// embeddings + LLM attempts + artifact/file writes and needs minutes.
// Separate proxies keep each timeout/retry policy explicit and conservative.
const { validateHcrContext } = wf.proxyActivities<
  typeof import("../activities/hcrActivities")
>({
  startToCloseTimeout: DATABASE_ACTIVITY_TIMEOUT,
  retry: { maximumAttempts: NODE_ACTIVITY_ATTEMPTS },
});

// Structured nodes get room for slow-provider LLM calls (a ~5-minute call
// falsely timed out in production once). Retrying stays safe for product
// state because the adapter reuses the artifact by nodeId; see
// runHcrNodeActivity docs for the known duplicate-event limitation.
// Heartbeats (30s interval, 120s timeout) renew the lease while the provider
// is slow-but-alive, so only genuinely dead workers time out. Parity on
// retry count remains 3 for parity with the former node functions.
const { runHcrNodeActivity } = wf.proxyActivities<
  typeof import("../activities/hcrActivities")
>({
  startToCloseTimeout: STRUCTURED_NODE_ACTIVITY_TIMEOUT,
  scheduleToCloseTimeout: NODE_SCHEDULE_TO_CLOSE_TIMEOUT,
  heartbeatTimeout: HEARTBEAT_TIMEOUT,
  retry: { maximumAttempts: NODE_ACTIVITY_ATTEMPTS },
});

// Tool-call nodes (FRONTEND_ENG / BACKEND_ENG) loop up to 20 agentic
// iterations with file I/O; they keep the longer budget. Same activity,
// same retry parity — only the timeout differs. Heartbeats as above.
const { runHcrNodeActivity: runHcrToolNode } = wf.proxyActivities<
  typeof import("../activities/hcrActivities")
>({
  startToCloseTimeout: TOOL_NODE_ACTIVITY_TIMEOUT,
  scheduleToCloseTimeout: NODE_SCHEDULE_TO_CLOSE_TIMEOUT,
  heartbeatTimeout: HEARTBEAT_TIMEOUT,
  retry: { maximumAttempts: NODE_ACTIVITY_ATTEMPTS },
});

// Coordinator port + finalize port: short DB-only steps.
const { createNextHcrNodes, finalizeHcrSlice } = wf.proxyActivities<
  typeof import("../activities/hcrActivities")
>({
  startToCloseTimeout: DATABASE_ACTIVITY_TIMEOUT,
  retry: { maximumAttempts: NODE_ACTIVITY_ATTEMPTS },
});

// Short, non-retried compensation: it only runs after a node activity has
// exhausted its own retries, and its writes are idempotent (conditional
// updateMany), so a single attempt suffices.
const { markHcrFailed } = wf.proxyActivities<
  typeof import("../activities/hcrActivities")
>({
  startToCloseTimeout: DATABASE_ACTIVITY_TIMEOUT,
  retry: { maximumAttempts: 1 },
});

// Verification/report creation is a short DB write; the sandbox work runs in
// an abandoned child workflow so a slow build never holds the HCR run open.
const { createBuildVerificationReport } = wf.proxyActivities<
  typeof import("../activities/verificationActivities")
>({
  startToCloseTimeout: DATABASE_ACTIVITY_TIMEOUT,
  retry: { maximumAttempts: 3 },
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
 * Mirrors the HCR transition graph exactly (`HCR_TRANSITION_MAP`: ARCHITECT →
 * RESEARCH → PRD_REVIEWER → PLANNER → FRONTEND_ENG + BACKEND_ENG in parallel
 * → finalize). The workflow stops issuing work only when the coordinator
 * port says `finalize` (then one guarded finalize call) or `wait` (a peer
 * still running — unreachable in this joined loop, kept for parity).
 *
 * Failure parity with the former `onFailure` handler: when node
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
  let finalStatus = validated.executionStatus;
  let compensatedNodeFailure = false;
  let anyIncomplete = false;

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
        compensatedNodeFailure = true;
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
        if (result.incomplete) anyIncomplete = true;
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
        } else {
          // The batch joins every spawned node before coordinating, so a
          // `wait` decision here violates the graph invariant. Surface it
          // instead of silently dropping a coordinator state.
          throw new Error(
            `Coordinator returned wait after a joined ${result.nodeType} batch`,
          );
        }
      }

      if (nextPending.length > 0) {
        pending = nextPending;
      } else {
        if (finalizeRequested) {
          await finalizeHcrSlice({
            identity: baseIdentity,
            partial: anyIncomplete,
          });
          finalStatus = anyIncomplete ? "PARTIAL" : "COMPLETED";

          if (!anyIncomplete) {
            const report = await createBuildVerificationReport({
              projectId: baseIdentity.projectId,
              executionId: baseIdentity.executionId,
              nodeId: lastNodeId,
            });
            if (report.reportId) {
              const verificationInput: VerificationWorkflowInput = {
                projectId: baseIdentity.projectId,
                userId: baseIdentity.userId,
                reportId: report.reportId,
                executionId: baseIdentity.executionId,
                nodeId: lastNodeId,
                initialAttempt: 1,
                maxAttempts: REPAIR_MAX_ATTEMPTS,
                keepPreview: true,
              };
              try {
                await wf.startChild(verificationWorkflow, {
                  workflowId: `verification-${report.reportId}`,
                  workflowExecutionTimeout: VERIFICATION_WORKFLOW_TIMEOUT,
                  parentClosePolicy: wf.ParentClosePolicy.ABANDON,
                  args: [verificationInput],
                });
              } catch {
                // Verification is additive: a child-start failure must not
                // turn a completed build into a failed one.
              }
            }
          }
        }
        pending = [];
      }
    }
  } catch (error) {
    // Node failures are already attributed to the failing node above. This
    // catch is for coordinator/finalize/transport failures, which have no
    // better node to attribute; compensate the trigger node once.
    if (!compensatedNodeFailure) {
      const reason = error instanceof Error ? error.message : String(error);
      await markHcrFailed({ identity: baseIdentity, reason });
    }
    throw error;
  }

  return {
    doableProjectId: validated.doableProjectId,
    doableWorkflowId: validated.doableWorkflowId,
    doableExecutionId: validated.doableExecutionId,
    doableNodeId: lastNodeId,
    executionStatus: finalStatus,
    nodeMigrated: true,
    temporalWorkflowId: wf.workflowInfo().workflowId,
    artifactId: lastArtifactId,
    artifactType: lastArtifactType,
    nodeType: lastNodeType,
    nodesCompleted,
    artifacts,
  };
}
