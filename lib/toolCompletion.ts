import { prisma } from "./prisma";

export type ToolCompletionAudit = Record<
  string,
  string | number | boolean
>;

export async function handleToolCompletion(
  executionId: string,
  nodeId: string,
  payload: {
    tool: string;
    audit: ToolCompletionAudit;
    iteration: number;
  },
): Promise<void> {
  await prisma.runtimeEvent.create({
    data: {
      executionId,
      nodeId,
      type: "tool.completed",
      payload: {
        tool: payload.tool,
        audit: payload.audit,
        iteration: payload.iteration,
      },
    },
  });
}
