import { prisma } from "@/lib/prisma";
import { WorkflowType, WorkflowStatus, ExecutionStatus, NodeStatus, NodeType } from "@prisma/client";

export async function startDiscoveryWorkflow(projectId: string) {
  const workflow = await prisma.workflow.create({
    data: {
      projectId,
      type: WorkflowType.DISCOVERY,
      status: WorkflowStatus.RUNNING, // Discovery is synchronous — start it running immediately
    },
  });

  const execution = await prisma.execution.create({
    data: {
      workflowId: workflow.id,
      status: ExecutionStatus.RUNNING,
    },
  });

  const node = await prisma.node.create({
    data: {
      executionId: execution.id,
      type: NodeType.DISCOVERY,
      status: NodeStatus.RUNNING,
      order: 1,
    },
  });

  await prisma.runtimeEvent.createMany({
    data: [
      { executionId: execution.id, type: "workflow.created", payload: { workflowId: workflow.id } },
      { executionId: execution.id, type: "workflow.running", payload: { workflowId: workflow.id } },
      { executionId: execution.id, type: "execution.created", payload: { executionId: execution.id } },
      { executionId: execution.id, type: "execution.running", payload: { executionId: execution.id } },
      { executionId: execution.id, nodeId: node.id, type: "node.created", payload: { nodeId: node.id } },
      { executionId: execution.id, nodeId: node.id, type: "node.running", payload: { nodeId: node.id } },
    ],
  });

  return { workflowId: workflow.id, executionId: execution.id, nodeId: node.id };
}
