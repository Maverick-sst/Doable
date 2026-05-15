import { WorkflowStatus, ExecutionStatus, NodeStatus, NodeType } from "@prisma/client";
import { prisma } from "./prisma";


export async function handleFailure( executionId: string, nodeId: string, workflowId: string) {
    const workflow = await prisma.workflow.update({
            where: {
                id: workflowId,
            },
            data: {
                status: WorkflowStatus.FAILED,
            }
        })
    
        const execution = await prisma.execution.update({
            where: {
                id: executionId,
            },
            data: {
                status: ExecutionStatus.FAILED,
            }
        })
    
        const node = await prisma.node.update({
            where: {
                id: nodeId
            },
            data: {
                status: NodeStatus.FAILED,
            }
        })
    
        await prisma.runtimeEvent.createMany({
            data: [
                { executionId: execution.id, type: "workflow.failed", payload: { workflowId: workflow.id } },
                { executionId: execution.id, type: "execution.failed", payload: { executionId: execution.id } },
                { executionId: execution.id, nodeId: node.id, type: "node.failed", payload: { nodeId: node.id, type: NodeType.ARCHITECT } },
            ]
        })
    
}