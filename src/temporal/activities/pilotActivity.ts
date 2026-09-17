import { prisma } from "@/lib/prisma";
import { ExecutionStatus } from "@prisma/client";
import type { TemporalPilotActivityInput } from "../contracts/types";

export interface PilotActivityResult {
  doableExecutionId: string;
  finalStatus: ExecutionStatus;
}

/**
 * Idempotently drive a Doable Execution from CREATED -> RUNNING -> COMPLETED.
 *
 * The activity is safe to retry/replay because every side-effect is guarded by
 * a conditional status check, and Doable identifiers are stable.
 */
export async function pilotActivity(
  input: TemporalPilotActivityInput,
): Promise<PilotActivityResult> {
  const { identity } = input;
  const { workflowId, executionId, projectId, userId, nodeId, taskId } = identity;

  const execution = await prisma.execution.findUnique({
    where: { id: executionId },
    include: {
      workflow: {
        include: {
          project: { select: { id: true, userId: true } },
        },
      },
    },
  });

  if (!execution) {
    throw new Error(`Execution ${executionId} not found`);
  }
  if (execution.workflowId !== workflowId) {
    throw new Error(
      `Execution ${executionId} does not belong to workflow ${workflowId}`,
    );
  }
  if (execution.workflow.project.id !== projectId) {
    throw new Error(
      `Workflow ${workflowId} does not belong to project ${projectId}`,
    );
  }
  if (execution.workflow.project.userId !== userId) {
    throw new Error(
      `Project ${projectId} does not belong to user ${userId}`,
    );
  }

  // CREATED -> RUNNING
  if (execution.status === ExecutionStatus.CREATED) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.execution.updateMany({
        where: { id: executionId, status: ExecutionStatus.CREATED },
        data: { status: ExecutionStatus.RUNNING },
      });

      if (updated.count > 0) {
        await tx.runtimeEvent.create({
          data: {
            executionId,
            nodeId: nodeId || null,
            type: "execution.running",
            payload: { taskId: taskId ?? null, source: "pilotActivity" },
          },
        });
      }
    });
  }

  const afterStart = await prisma.execution.findUniqueOrThrow({
    where: { id: executionId },
  });

  // RUNNING -> COMPLETED
  if (afterStart.status === ExecutionStatus.RUNNING) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.execution.updateMany({
        where: { id: executionId, status: ExecutionStatus.RUNNING },
        data: { status: ExecutionStatus.COMPLETED },
      });

      if (updated.count > 0) {
        await tx.runtimeEvent.create({
          data: {
            executionId,
            nodeId: nodeId || null,
            type: "execution.completed",
            payload: { taskId: taskId ?? null, source: "pilotActivity" },
          },
        });
      }
    });
  }

  const final = await prisma.execution.findUniqueOrThrow({
    where: { id: executionId },
  });

  return { doableExecutionId: executionId, finalStatus: final.status };
}
