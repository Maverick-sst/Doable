import { ApplicationFailure } from "@temporalio/activity";
import { prisma } from "@/lib/prisma";
import type {
  TemporalHcrActivityInput,
  ValidatedHcrContext,
  HcrNodeBoundaryResult,
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
