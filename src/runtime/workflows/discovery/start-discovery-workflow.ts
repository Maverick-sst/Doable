import {
  ExecutionStatus,
  NodeStatus,
  NodeType,
  WorkflowStatus,
  WorkflowType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Discovery turns are synchronous, but their state rows still commit
 * atomically so a failed turn never leaves an orphan workflow.
 */
export async function startDiscoveryWorkflow(projectId: string) {
  return prisma.$transaction(async (tx) => {
    const workflow = await tx.workflow.create({
      data: {
        projectId,
        type: WorkflowType.DISCOVERY,
        status: WorkflowStatus.RUNNING,
      },
    });

    const execution = await tx.execution.create({
      data: {
        workflowId: workflow.id,
        status: ExecutionStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    const node = await tx.node.create({
      data: {
        executionId: execution.id,
        type: NodeType.DISCOVERY,
        status: NodeStatus.RUNNING,
        order: 1,
        startedAt: new Date(),
      },
    });

    await tx.runtimeEvent.createMany({
      data: [
        {
          executionId: execution.id,
          type: "workflow.created",
          payload: { workflowId: workflow.id },
        },
        {
          executionId: execution.id,
          type: "workflow.running",
          payload: { workflowId: workflow.id },
        },
        {
          executionId: execution.id,
          type: "execution.created",
          payload: { executionId: execution.id },
        },
        {
          executionId: execution.id,
          type: "execution.running",
          payload: { executionId: execution.id },
        },
        {
          executionId: execution.id,
          nodeId: node.id,
          type: "node.created",
          payload: { nodeId: node.id },
        },
        {
          executionId: execution.id,
          nodeId: node.id,
          type: "node.running",
          payload: { nodeId: node.id },
        },
      ],
    });

    return {
      workflowId: workflow.id,
      executionId: execution.id,
      nodeId: node.id,
    };
  });
}