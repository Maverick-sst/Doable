import { prisma } from "./prisma";

export async function handleToolCompletion(executionId: string, nodeId: string, payload: { tool: string, result: string, iteration: number }): Promise<void> {

    await prisma.runtimeEvent.create({
        data: {
            executionId: executionId,
            nodeId: nodeId,
            type: "tool.completed",
            payload: {
                tool: payload.tool,
                result: payload.result,
                iteration: payload.iteration
            }
        }
    })
}