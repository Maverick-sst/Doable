import { prisma } from "@/lib/prisma";
import { WorkflowType, WorkflowStatus, ExecutionStatus, NodeStatus, NodeType } from "@prisma/client";

export async function startHCRWorkflow(projectId: string, userId: string, prompt: string) {
  const workflow = await prisma.workflow.create({
    data: {
      projectId,
      type: WorkflowType.HCR, // Fixed: was MVP_GENERATION
      status: WorkflowStatus.CREATED,
    },
  });

  const execution = await prisma.execution.create({
    data: {
      workflowId: workflow.id,
      status: ExecutionStatus.CREATED,
    },
  });

  const node = await prisma.node.create({
    data: {
      executionId: execution.id,
      type: NodeType.ARCHITECT,
      status: NodeStatus.CREATED,
      order: 1,
    },
  });

  await prisma.runtimeEvent.createMany({
    data: [
      { executionId: execution.id, type: "workflow.created", payload: { workflowId: workflow.id } },
      { executionId: execution.id, type: "execution.created", payload: { executionId: execution.id } },
      { executionId: execution.id, nodeId: node.id, type: "node.created", payload: { nodeId: node.id, type: NodeType.ARCHITECT } },
    ],
  });

  return { workflowId: workflow.id, executionId: execution.id, nodeId: node.id };
}
