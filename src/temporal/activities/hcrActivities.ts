import { ApplicationFailure } from "@temporalio/activity";
import { NodeType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AGENT_REGISTRY } from "@/src/cognition/agent-registry";
import { executeNode } from "@/src/cognition/node-executor";
import type {
  TemporalHcrActivityInput,
  ValidatedHcrContext,
  HcrNodeBoundaryResult,
  RunArchitectNodeActivityInput,
  ArchitectNodeActivityResult,
} from "../contracts/hcr";

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
        nodes: { where: { id: nodeId }, select: { id: true, status: true } },
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
  const { identity, prompt, inputArtifactId } = input;

  if (!prompt || typeof prompt !== "string") {
    throw ApplicationFailure.nonRetryable(
      "ARCHITECT activity requires the original user prompt",
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

  if (storedNode.type !== NodeType.ARCHITECT) {
    throw ApplicationFailure.nonRetryable(
      `Node ${identity.nodeId} is ${storedNode.type}, not ARCHITECT`,
      "HcrWrongNodeType",
    );
  }

  const nodeConfig = AGENT_REGISTRY[NodeType.ARCHITECT];
  if (!nodeConfig) {
    throw ApplicationFailure.nonRetryable(
      "ARCHITECT config missing from AGENT_REGISTRY",
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
    if (
      message.includes("Failed to parse/validate JSON") ||
      message.includes("not found") ||
      message.includes("does not belong")
    ) {
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
