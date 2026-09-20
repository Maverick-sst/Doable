import { ApplicationFailure } from "@temporalio/activity";
import {
  NodeType,
  WorkflowStatus,
  ExecutionStatus,
  NodeStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AGENT_REGISTRY } from "@/src/cognition/agent-registry";
import { executeNode } from "@/src/cognition/node-executor";
import { HCR_TRANSITION_MAP } from "@/src/runtime/workflows/hcr/transition-map";
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
 * Inngest suppression: `executeNode` is invoked with `emitCompletionEvent:false`
 * so the Temporal path does not also fire `node/completed` into the Inngest
 * coordinator (which would fork sequencing). The Inngest path keeps the default
 * true and is behaviorally unchanged.
 *
 * Retry safety: relies on the existing `artifact.findFirst({nodeId})` reuse —
 * a retried Activity reuses the same artifact instead of creating a duplicate.
 * LIMITATION (documented, not fixed here to avoid changing Inngest behavior):
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
 * Inngest suppression, retry safety (artifact reuse by `nodeId`), and failure
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
    result = await executeNode({
      projectId: identity.projectId,
      userId: identity.userId,
      workflowId: identity.workflowId,
      executionId: identity.executionId,
      nodeId: identity.nodeId,
      prompt,
      inputArtifactId: inputArtifactId ?? null,
      nodeConfig,
      emitCompletionEvent: false,
    });
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
 * Mirrors `app/inngest/functions/workflow-coordinator.ts` decision-for-decision
 * (`HCR_TRANSITION_MAP` lookup, parallel wait-for-peer guard, terminal
 * finalize) but performs NO Inngest sends — it returns the decision and lets
 * the workflow drive the next Activities. Creates next `Node(CREATED)` rows +
 * `node.created` events exactly like the coordinator.
 *
 * Parity note: like the Inngest coordinator, spawned-node creation carries no
 * dedup key (parked caveat C3). The Inngest coordinator is untouched.
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
    const node = await prisma.node.create({
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
        payload: { nodeId: node.id, type: nodeType, nodeType },
      },
    });

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
 * Unlike the Inngest original, writes are conditional (transition-guarded) so
 * a retried or twice-reached finalize marks COMPLETED exactly once without
 * duplicating completion events. The Inngest path is untouched.
 */
export async function finalizeHcrSlice(
  input: FinalizeHcrSliceInput,
): Promise<FinalizeHcrSliceResult> {
  const { identity } = input;
  const { workflowId, executionId, projectId } = identity;

  const finalized = await prisma.$transaction(async (tx) => {
    const finalizedExecution = await tx.execution.updateMany({
      where: { id: executionId, status: { not: ExecutionStatus.COMPLETED } },
      data: { status: ExecutionStatus.COMPLETED },
    });
    const finalizedWorkflow = await tx.workflow.updateMany({
      where: { id: workflowId, status: { not: WorkflowStatus.COMPLETED } },
      data: { status: WorkflowStatus.COMPLETED },
    });

    const transitioned =
      finalizedExecution.count > 0 || finalizedWorkflow.count > 0;

    if (transitioned) {
      await tx.project.update({
        where: { id: projectId },
        data: { status: "IDLE" },
      });
      await tx.runtimeEvent.createMany({
        data: [
          { executionId, type: "execution.completed", payload: { executionId } },
          { executionId, type: "workflow.completed", payload: { workflowId } },
        ],
      });
    }

    return transitioned;
  });

  return { doableExecutionId: executionId, finalized };
}

/**
 * Failure compensation for the Temporal HCR path (Agent 05 cutover).
 *
 * Mirrors `lib/handleFailure` row-for-row (workflow/execution/node → FAILED +
 * `workflow.failed` / `execution.failed` / `node.failed` events) so the
 * Temporal terminal state is inspectable exactly like the Inngest one.
 * Parity note: like `handleFailure`, it does NOT touch `Project` — a failed
 * run leaves the project IN_PROGRESS in both orchestrators.
 *
 * Idempotency: every write is guarded by a conditional status check inside one
 * transaction, so compensation retry/replay marks FAILED exactly once and
 * never duplicates failure events. Returns `markedFailed:false` when rows
 * were already FAILED.
 *
 * Only the Temporal workflow calls this (on node-activity exhaustion). The
 * Inngest `onFailure → handleFailure` path is untouched.
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

  const markedFailed = await prisma.$transaction(async (tx) => {
    const failedWorkflow = await tx.workflow.updateMany({
      where: { id: workflowId, status: { not: WorkflowStatus.FAILED } },
      data: { status: WorkflowStatus.FAILED },
    });
    const failedExecution = await tx.execution.updateMany({
      where: { id: executionId, status: { not: ExecutionStatus.FAILED } },
      data: { status: ExecutionStatus.FAILED },
    });
    const failedNode = await tx.node.updateMany({
      where: { id: nodeId, status: { not: NodeStatus.FAILED } },
      data: { status: NodeStatus.FAILED },
    });

    const transitioned =
      failedWorkflow.count > 0 ||
      failedExecution.count > 0 ||
      failedNode.count > 0;

    if (transitioned) {
      await tx.runtimeEvent.createMany({
        data: [
          {
            executionId,
            type: "workflow.failed",
            payload: { workflowId, source: "temporal", reason },
          },
          {
            executionId,
            type: "execution.failed",
            payload: { executionId, source: "temporal", reason },
          },
          {
            executionId,
            nodeId,
            type: "node.failed",
            payload: { nodeId, source: "temporal", reason },
          },
        ],
      });
    }

    return transitioned;
  });

  return { doableExecutionId: executionId, doableNodeId: nodeId, markedFailed };
}
