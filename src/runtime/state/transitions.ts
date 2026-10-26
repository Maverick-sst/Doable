import {
  ExecutionStatus,
  NodeStatus,
  ProjectStatus,
  WorkflowStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type FailureCode =
  | "provider_error"
  | "validation_error"
  | "timeout"
  | "cancelled"
  | "trigger_error"
  | "unknown";

export interface ExecutionIdentity {
  projectId: string;
  workflowId: string;
  executionId: string;
  nodeId?: string;
}

export interface FailureInput extends ExecutionIdentity {
  reason: string;
  code?: FailureCode;
}

function safeReason(reason: string): string {
  return reason.replace(/\s+/g, " ").trim().slice(0, 2000);
}

/**
 * Single failure transition for workflow, execution, node, project, and
 * events. It is idempotent and deliberately sets a terminal project state so
 * a failed run can be retried from the product UI without a manual DB edit.
 */
export async function failExecution(input: FailureInput) {
  const reason = safeReason(input.reason);
  const code = input.code ?? "unknown";

  return prisma.$transaction(async (tx) => {
    const workflow = await tx.workflow.updateMany({
      where: { id: input.workflowId, status: { not: WorkflowStatus.FAILED } },
      data: { status: WorkflowStatus.FAILED },
    });

    const execution = await tx.execution.updateMany({
      where: {
        id: input.executionId,
        status: { not: ExecutionStatus.FAILED },
      },
      data: {
        status: ExecutionStatus.FAILED,
        failureReason: reason,
        finishedAt: new Date(),
      },
    });

    const node = input.nodeId
      ? await tx.node.updateMany({
          where: { id: input.nodeId, status: { not: NodeStatus.FAILED } },
          data: {
            status: NodeStatus.FAILED,
            failureReason: reason,
            finishedAt: new Date(),
          },
        })
      : { count: 0 };

    const project = await tx.project.updateMany({
      where: {
        id: input.projectId,
        status: { not: ProjectStatus.FAILED },
      },
      data: { status: ProjectStatus.FAILED, failureReason: reason },
    });

    const transitioned =
      workflow.count > 0 ||
      execution.count > 0 ||
      node.count > 0 ||
      project.count > 0;

    if (transitioned) {
      await tx.runtimeEvent.createMany({
        data: [
          {
            executionId: input.executionId,
            type: "workflow.failed",
            payload: { workflowId: input.workflowId, code },
          },
          {
            executionId: input.executionId,
            type: "execution.failed",
            payload: { executionId: input.executionId, code },
          },
          ...(input.nodeId
            ? [
                {
                  executionId: input.executionId,
                  nodeId: input.nodeId,
                  type: "node.failed",
                  payload: { nodeId: input.nodeId, code },
                },
              ]
            : []),
        ],
      });
    }

    return { transitioned, projectId: input.projectId };
  });
}

/**
 * Terminal success transition. Safe to call twice; guarded writes avoid
 * duplicate completion events.
 */
export async function completeExecution(input: ExecutionIdentity) {
  return prisma.$transaction(async (tx) => {
    // A late completion must never resurrect a failed or cancelled run.
    const execution = await tx.execution.updateMany({
      where: {
        id: input.executionId,
        status: { notIn: [
          ExecutionStatus.COMPLETED,
          ExecutionStatus.FAILED,
          ExecutionStatus.CANCELLED,
        ] },
      },
      data: {
        status: ExecutionStatus.COMPLETED,
        finishedAt: new Date(),
        failureReason: null,
      },
    });

    if (execution.count === 0) {
      return { transitioned: false, projectId: input.projectId };
    }

    await tx.workflow.updateMany({
      where: { id: input.workflowId, status: { not: WorkflowStatus.COMPLETED } },
      data: { status: WorkflowStatus.COMPLETED },
    });

    await tx.project.update({
      where: { id: input.projectId },
      data: { status: ProjectStatus.IDLE, failureReason: null },
    });

    await tx.runtimeEvent.createMany({
      data: [
        {
          executionId: input.executionId,
          type: "execution.completed",
          payload: { executionId: input.executionId },
        },
        {
          executionId: input.executionId,
          type: "workflow.completed",
          payload: { workflowId: input.workflowId },
        },
      ],
    });

    return { transitioned: true, projectId: input.projectId };
  });
}

/**
 * Cancellation is a product action, not a node failure. The project returns
 * to IDLE so the user can start a new attempt.
 */
export async function cancelExecution(input: ExecutionIdentity & { reason?: string }) {
  const reason = safeReason(input.reason ?? "Cancelled by user");

  return prisma.$transaction(async (tx) => {
    const execution = await tx.execution.updateMany({
      where: {
        id: input.executionId,
        status: { in: [ExecutionStatus.CREATED, ExecutionStatus.RUNNING] },
      },
      data: {
        status: ExecutionStatus.CANCELLED,
        failureReason: reason,
        finishedAt: new Date(),
      },
    });

    const workflow = await tx.workflow.updateMany({
      where: {
        id: input.workflowId,
        status: { in: [WorkflowStatus.CREATED, WorkflowStatus.QUEUED, WorkflowStatus.RUNNING, WorkflowStatus.PAUSED] },
      },
      data: { status: WorkflowStatus.CANCELLED },
    });

    await tx.node.updateMany({
      where: {
        executionId: input.executionId,
        status: { in: [NodeStatus.CREATED, NodeStatus.RUNNING] },
      },
      data: { status: NodeStatus.SKIPPED, finishedAt: new Date() },
    });

    await tx.project.update({
      where: { id: input.projectId },
      data: { status: ProjectStatus.IDLE, failureReason: reason },
    });

    const transitioned = execution.count > 0 || workflow.count > 0;
    if (transitioned) {
      await tx.runtimeEvent.createMany({
        data: [
          {
            executionId: input.executionId,
            type: "execution.cancelled",
            payload: { executionId: input.executionId, reason },
          },
          {
            executionId: input.executionId,
            type: "workflow.cancelled",
            payload: { workflowId: input.workflowId, reason },
          },
        ],
      });
    }

    return { transitioned };
  });
}

/**
 * Retry re-opens a failed project for a new run. It never mutates historical
 * executions or artifacts.
 */
export async function reopenProjectForRetry(projectId: string) {
  return prisma.project.updateMany({
    where: { id: projectId, status: { in: [ProjectStatus.FAILED, ProjectStatus.IDLE] } },
    data: { status: ProjectStatus.PENDING, failureReason: null },
  });
}

export async function markExecutionRunning(executionId: string) {
  return prisma.execution.updateMany({
    where: { id: executionId, status: { in: [ExecutionStatus.CREATED, ExecutionStatus.RUNNING] } },
    data: { status: ExecutionStatus.RUNNING, startedAt: new Date() },
  });
}

export async function markNodeRunning(executionId: string, nodeId: string) {
  return prisma.node.updateMany({
    where: { id: nodeId, executionId, status: { in: [NodeStatus.CREATED, NodeStatus.RUNNING] } },
    data: {
      status: NodeStatus.RUNNING,
      startedAt: new Date(),
      attempt: { increment: 1 },
    },
  });
}