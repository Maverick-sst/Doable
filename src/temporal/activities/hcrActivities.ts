import { ApplicationFailure, Context } from "@temporalio/activity";
import { NodeStatus, NodeType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AGENT_REGISTRY } from "@/src/cognition/agent-registry";
import { executeNode } from "@/src/cognition/node-executor";
import { HCR_TRANSITION_MAP } from "@/src/runtime/workflows/hcr/transition-map";
import {
  completeExecution,
  failExecution,
} from "@/src/runtime/state/transitions";
import type {
  TemporalHcrActivityInput,
  ValidatedHcrContext,
  HcrNodeBoundaryResult,
  RunArchitectNodeActivityInput,
  ArchitectNodeActivityResult,
  RunHcrNodeActivityInput,
  HcrNodeActivityResult,
  CreateNextHcrNodesInput,
  CreateNextHcrNodesResult,
  FinalizeHcrSliceInput,
  FinalizeHcrSliceResult,
  MarkHcrFailedActivityInput,
  MarkHcrFailedActivityResult,
} from "../contracts/hcr";
import { isHcrDomainFailure } from "../contracts/hcr";

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Heartbeat lease renewal around a long, non-interruptible operation (LLM
 * waits). The wrapped function runs to completion regardless — heartbeats
 * cannot abort an in-flight provider call — but while they arrive the server
 * treats the activity as alive instead of falsely timing it out, and worker
 * loss becomes detectable at the heartbeat timeout. Attempt forensics that
 * used to depend on lossy history exports now also live in worker logs via
 * the start/finish lines this helper emits.
 */
async function withHeartbeat<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const attempt = Context.current().info.attempt;
  const startedAt = Date.now();
  console.log(`[hcr-activity] start ${label} attempt=${attempt}`);
  const timer = setInterval(() => {
    try {
      Context.current().heartbeat({ label, attempt });
    } catch {
      // Activity context gone (shutdown path); the operation itself still
      // runs to completion and reports normally on settle.
    }
  }, HEARTBEAT_INTERVAL_MS);
  try {
    const result = await fn();
    console.log(
      `[hcr-activity] finish ${label} attempt=${attempt} ` +
        `elapsedMs=${Date.now() - startedAt}`,
    );
    return result;
  } catch (error) {
    console.log(
      `[hcr-activity] error ${label} attempt=${attempt} ` +
        `elapsedMs=${Date.now() - startedAt} ` +
        `message=${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  } finally {
    clearInterval(timer);
  }
}

/**
 * Read-only validation that the Doable rows referenced by Temporal exist and
 * belong together. Prisma I/O lives here because Workflows must stay
 * deterministic; Activities own all side effects (even reads, so replay is safe).
 *
 * Idempotency: pure read, no writes, so retry/replay is always safe.
 * Failure: unknown execution or ownership mismatch is non-retryable (retrying
 * cannot fix bad identity). Transient DB errors propagate as retryable.
 */
export async function validateHcrContext(
  input: TemporalHcrActivityInput,
): Promise<ValidatedHcrContext> {
  const { identity } = input;
  const { workflowId, executionId, projectId, userId, nodeId } = identity;

  if (!workflowId || !executionId || !projectId || !userId || !nodeId) {
    throw ApplicationFailure.nonRetryable(
      "HCR identity incomplete: workflowId/executionId/projectId/userId/nodeId required",
      "HcrInvalidIdentity",
    );
  }

  let execution;
  try {
    execution = await prisma.execution.findUnique({
      where: { id: executionId },
      include: {
        workflow: { include: { project: { select: { id: true, userId: true } } } },
        nodes: {
          where: { id: nodeId },
          select: { id: true, status: true, type: true },
        },
      },
    });
  } catch (error) {
    // Connection-level failure: let Temporal retry per policy.
    throw error instanceof Error ? error : new Error(String(error));
  }

  if (!execution) {
    throw ApplicationFailure.nonRetryable(
      `Execution ${executionId} not found`,
      "HcrExecutionNotFound",
    );
  }
  if (execution.workflowId !== workflowId) {
    throw ApplicationFailure.nonRetryable(
      `Execution ${executionId} does not belong to workflow ${workflowId}`,
      "HcrCorrelationMismatch",
    );
  }
  if (execution.workflow.project.id !== projectId) {
    throw ApplicationFailure.nonRetryable(
      `Workflow ${workflowId} does not belong to project ${projectId}`,
      "HcrCorrelationMismatch",
    );
  }
  if (execution.workflow.project.userId !== userId) {
    throw ApplicationFailure.nonRetryable(
      `Project ${projectId} does not belong to user`,
      "HcrOwnershipMismatch",
    );
  }

  const node = execution.nodes[0];
  if (!node) {
    throw ApplicationFailure.nonRetryable(
      `Node ${nodeId} not found in execution ${executionId}`,
      "HcrNodeNotFound",
    );
  }

  return {
    doableProjectId: projectId,
    doableWorkflowId: workflowId,
    doableExecutionId: executionId,
    doableNodeId: node.id,
    nodeType: node.type,
    executionStatus: execution.status,
    nodeStatus: node.status,
  };
}

/**
 * Single migration-ready node Activity boundary (skeleton only).
 *
 * Why an Activity: the real node performs LLM calls, Prisma writes, and file
 * tool I/O — all non-deterministic side effects forbidden in Workflows.
 *
 * This skeleton intentionally performs NO cognition and NO writes. It re-reads
 * the node row so the boundary is proven end-to-end (workflow → activity →
 * Postgres → result) without migrating ARCHITECT or any other real node.
 * Agent 03 replaces this body with a wrapper around the existing `executeNode`
 * implementation; retry safety and failure classification for that step belong
 * to Agent 03.
 */
export async function runHcrNodeBoundary(
  input: TemporalHcrActivityInput,
): Promise<HcrNodeBoundaryResult> {
  const { identity } = input;

  const node = await prisma.node.findUnique({
    where: { id: identity.nodeId },
    select: { id: true, executionId: true },
  });

  if (!node || node.executionId !== identity.executionId) {
    throw ApplicationFailure.nonRetryable(
      `Node ${identity.nodeId} not found in execution ${identity.executionId}`,
      "HcrNodeNotFound",
    );
  }

  return {
    doableExecutionId: identity.executionId,
    doableNodeId: node.id,
    nodeMigrated: false,
    reason: "skeleton-boundary-only: no cognition executed; Agent 03 wires real node",
  };
}

/**
 * First real HCR node adapter: ARCHITECT behind the Temporal Activity boundary.
 *
 * Verified against HCR_MIGRATION_MAP.md §2: the chat entry path always emits an
 * ARCHITECT node (order:1) with inputArtifactId null, so ARCHITECT is the
 * correct first slice.
 *
 * Why wrapped, not rewritten: the existing `executeNode` + `AGENT_REGISTRY`
 * own all cognition (prompts, context, LLM, validators, artifact versioning).
 * Temporal owns durable sequencing, timeout, retry, recovery, correlation.
 *
 * Why an Activity: LLM calls, embeddings, Prisma writes, and file I/O are
 * non-deterministic side effects forbidden in Workflows.
 *
 * Temporal owns sequencing; `executeNode` no longer emits orchestration
 * events into a second orchestrator. Node completion is persisted to Postgres and the
 * workflow coordinator port decides the next step.
 *
 * Retry safety: relies on the existing `artifact.findFirst({nodeId})` reuse —
 * a retried Activity reuses the same artifact instead of creating a duplicate.
 * LIMITATION (historical, now partly addressed by the state seam):
 * `execution.running` / `node.running` / `node.completed` events are
 * unconditional creates, so a Temporal retry can duplicate those events while
 * artifact state stays single. Agent 04 verifies this explicitly.
 *
 * Failure classification (existing `executeNode` throws plain Errors, so this
 * adapter classifies by message rather than inventing a new taxonomy):
 * - non-retryable: bad identity/node mismatch, LLM JSON validation exhausted
 *   (`Failed to parse/validate JSON`), missing records;
 * - retryable: DB/embedding/LLM transport errors (Temporal retries per policy).
 */
export async function runArchitectNode(
  input: RunArchitectNodeActivityInput,
): Promise<ArchitectNodeActivityResult> {
  // Thin delegate preserved for backward compatibility (Agent 03 contract).
  // All node types share one implementation below; ARCHITECT behavior is
  // unchanged — the S1 runtime trace stays valid.
  const result = await runHcrNodeActivity({
    identity: input.identity,
    nodeType: NodeType.ARCHITECT,
    prompt: input.prompt,
    inputArtifactId: input.inputArtifactId ?? null,
  });

  return {
    doableProjectId: result.doableProjectId,
    doableWorkflowId: result.doableWorkflowId,
    doableExecutionId: result.doableExecutionId,
    doableNodeId: result.doableNodeId,
    nodeType: result.nodeType,
    artifactId: result.artifactId,
    artifactType: result.artifactType,
    nodeMigrated: true as const,
  };
}

/**
 * Generic HCR node adapter behind the Temporal Activity boundary.
 *
 * Same wrap-don't-rewrite contract as the original ARCHITECT adapter: the
 * existing `executeNode` + `AGENT_REGISTRY` entry own all cognition, Temporal
 * owns sequencing/timeout/retry/recovery/correlation. Covers structured_json
 * nodes (RESEARCH, PRD_REVIEWER, PLANNER) and tool_calls nodes
 * (FRONTEND_ENG, BACKEND_ENG) uniformly — `executeNode` already branches on
 * `outputMode`, so no per-node code is needed.
 *
 * Orchestration suppression, retry safety (artifact reuse by `nodeId`), and failure
 * classification behave exactly as documented on `runArchitectNode`.
 * Known parked caveats (HCR_KNOWN_CAVEATS.md): C2 duplicate events on retry,
 * C5 file-write idempotency for FE/BE.
 */
export async function runHcrNodeActivity(
  input: RunHcrNodeActivityInput,
): Promise<HcrNodeActivityResult> {
  const { identity, nodeType, prompt, inputArtifactId } = input;

  if (!prompt || typeof prompt !== "string") {
    throw ApplicationFailure.nonRetryable(
      `HCR ${nodeType} activity requires the original user prompt`,
      "HcrMissingPrompt",
    );
  }

  const storedNode = await prisma.node.findUnique({
    where: { id: identity.nodeId },
    select: { id: true, executionId: true, type: true },
  });

  if (!storedNode || storedNode.executionId !== identity.executionId) {
    throw ApplicationFailure.nonRetryable(
      `Node ${identity.nodeId} not found in execution ${identity.executionId}`,
      "HcrNodeNotFound",
    );
  }

  if (storedNode.type !== nodeType) {
    throw ApplicationFailure.nonRetryable(
      `Node ${identity.nodeId} is ${storedNode.type}, not ${nodeType}`,
      "HcrWrongNodeType",
    );
  }

  const nodeConfig = AGENT_REGISTRY[nodeType];
  if (!nodeConfig) {
    throw ApplicationFailure.nonRetryable(
      `${nodeType} config missing from AGENT_REGISTRY`,
      "HcrMissingNodeConfig",
    );
  }

  let result: Awaited<ReturnType<typeof executeNode>>;
  try {
    // Heartbeats renew the server lease during slow-provider LLM waits so a
    // live-but-slow call is not falsely timed out. They cannot abort the
    // in-flight call — a past-lease completion still writes (parked caveat).
    result = await withHeartbeat(`${nodeType}/${identity.nodeId}`, () =>
      executeNode({
        projectId: identity.projectId,
        userId: identity.userId,
        workflowId: identity.workflowId,
        executionId: identity.executionId,
        nodeId: identity.nodeId,
        prompt,
        inputArtifactId: inputArtifactId ?? null,
        nodeConfig,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isHcrDomainFailure(message)) {
      throw ApplicationFailure.nonRetryable(message, "HcrDomainFailure");
    }
    throw error instanceof Error ? error : new Error(message);
  }

  return {
    doableProjectId: result.projectId,
    doableWorkflowId: result.workflowId,
    doableExecutionId: result.executionId,
    doableNodeId: identity.nodeId,
    nodeType: result.nodeType,
    artifactId: result.artifactId,
    artifactType: nodeConfig.outputArtifactType,
    nodeMigrated: true as const,
  };
}

/**
 * Coordinator port: decides the next step after one node completes.
 *
 * Ports the former coordinator decision-for-decision
 * (`HCR_TRANSITION_MAP` lookup, parallel wait-for-peer guard, terminal
 * finalize) but performs no event sends — it returns the decision and lets
 * the workflow drive the next Activities. Creates next `Node(CREATED)` rows +
 * `node.created` events exactly like the coordinator.
 *
 * Parity note: like the former coordinator, spawned-node creation carries no
 * dedup key (parked caveat C3). The former coordinator is retired.
 */
export async function createNextHcrNodes(
  input: CreateNextHcrNodesInput,
): Promise<CreateNextHcrNodesResult> {
  const { identity, outputArtifactId, outputArtifactType } = input;
  const { executionId } = identity;

  const transition = outputArtifactType
    ? HCR_TRANSITION_MAP[outputArtifactType]
    : null;

  if (!transition) {
    if (outputArtifactType === null) {
      const runningNodes = await prisma.node.count({
        where: {
          executionId,
          status: { in: [NodeStatus.CREATED, NodeStatus.RUNNING] },
        },
      });
      if (runningNodes > 0) return { action: "wait", nextNodes: [] };
    }
    return { action: "finalize", nextNodes: [] };
  }

  const nextNodes = [];
  for (const nodeType of transition.nextNodes) {
    // Deterministic graph identity: a retried coordinator call reuses the
    // node instead of forking the graph. The unique index backs the race.
    let node = await prisma.node.findFirst({
      where: { executionId, order: transition.order, type: nodeType },
    });

    if (!node) {
      try {
        node = await prisma.node.create({
          data: {
            executionId,
            type: nodeType,
            status: NodeStatus.CREATED,
            order: transition.order,
          },
        });
        await prisma.runtimeEvent.create({
          data: {
            executionId,
            nodeId: node.id,
            type: "node.created",
            payload: {
              nodeId: node.id,
              type: nodeType,
              nodeType,
              order: transition.order,
            },
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          node = await prisma.node.findFirst({
            where: { executionId, order: transition.order, type: nodeType },
          });
        } else {
          throw error;
        }
      }
    }

    if (!node) {
      throw new Error(
        `Could not create or find ${nodeType} node at order ${transition.order}`,
      );
    }

    nextNodes.push({
      nodeId: node.id,
      nodeType,
      inputArtifactId: outputArtifactId,
    });
  }

  return { action: "spawn", nextNodes };
}

/**
 * Finalize port: mirrors `finalizeWorkflow` (execution/workflow COMPLETED,
 * project IDLE, `execution.completed` + `workflow.completed` events).
 *
 * Unlike the former implementation, writes are conditional (transition-guarded) so
 * a retried or twice-reached finalize marks COMPLETED exactly once without
 * duplicating completion events.
 */
export async function finalizeHcrSlice(
  input: FinalizeHcrSliceInput,
): Promise<FinalizeHcrSliceResult> {
  const { identity } = input;
  const { workflowId, executionId, projectId } = identity;

  const result = await completeExecution({
    projectId,
    workflowId,
    executionId,
  });

  return { doableExecutionId: executionId, finalized: result.transitioned };
}

/**
 * Failure compensation for the Temporal HCR path (Agent 05 cutover).
 *
 * Mirrors `lib/handleFailure` row-for-row (workflow/execution/node → FAILED +
 * `workflow.failed` / `execution.failed` / `node.failed` events) so the
 * Temporal terminal state is inspectable in the same product shape as before.
 * Parity note: like `handleFailure`, it does NOT touch `Project` — a failed
 * run leaves the project IN_PROGRESS in both orchestrators.
 *
 * Idempotency: every write is guarded by a conditional status check inside one
 * transaction, so compensation retry/replay marks FAILED exactly once and
 * never duplicates failure events. Returns `markedFailed:false` when rows
 * were already FAILED.
 *
 * Only the Temporal workflow calls this (on node-activity exhaustion). The
 * The former `onFailure → handleFailure` path is retired.
 */
export async function markHcrFailed(
  input: MarkHcrFailedActivityInput,
): Promise<MarkHcrFailedActivityResult> {
  const { identity, reason } = input;
  const { workflowId, executionId, nodeId } = identity;

  if (!workflowId || !executionId || !nodeId) {
    throw ApplicationFailure.nonRetryable(
      "HCR identity incomplete: workflowId/executionId/nodeId required",
      "HcrInvalidIdentity",
    );
  }

  const result = await failExecution({
    projectId: identity.projectId,
    workflowId,
    executionId,
    nodeId,
    reason,
    code: "unknown",
  });

  return {
    doableExecutionId: executionId,
    doableNodeId: nodeId,
    markedFailed: result.transitioned,
  };
}
