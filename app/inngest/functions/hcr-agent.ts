import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { getEmbeddings } from "@/lib/embeddings";
import { buildContext } from "@/src/cognition/context-engine";
import { callLLM } from "@/src/cognition/llm";
import { tools } from "@/lib/tools";
import { executeTool } from "@/lib/tool-executor";
import { ExecutionStatus, NodeStatus, NodeType, ArtifactType, MessagePhase } from "@prisma/client";
import { handleFailure } from "@/lib/handleFailure";
import { handleToolCompletion } from "@/lib/toolCompletion";

export const hcrAgentFunction = inngest.createFunction(
  {
    id: "hcr-agent",
    retries: 3,
    onFailure: async ({ event }) => {
      const { workflowId, executionId, nodeId } = event.data.event.data;
      await handleFailure(executionId, nodeId, workflowId);
    },
    triggers: [{ event: "chat/requested" }],
  },
  async ({ event, step }) => {
    // STEP 1: Fetch all context needed before the agent loop
    const contextData = await step.run("fetch_initial_context", async () => {
      const { projectId, userId, prompt } = event.data;

      const project = await prisma.project.findFirst({
        where: { id: projectId, userId },
        include: {
          files: { select: { id: true, path: true, embeddingStatus: true } },
          messages: {
            where: { phase: MessagePhase.BUILD }, // BUILD phase messages only
            orderBy: { createdAt: "desc" },
            take: 10,
            select: { role: true, content: true },
          },
        },
      });

      // Fetch the latest DISCOVERY_REQUIREMENT artifact for this project
      const discoveryArtifact = await prisma.artifact.findFirst({
        where: { projectId, type: ArtifactType.DISCOVERY_REQUIREMENT },
        orderBy: { version: "desc" },
      });

      return {
        projectId: project?.id ?? "",
        files: project?.files ?? [],
        messages: project?.messages?.reverse() ?? [],
        prompt,
        discoveryArtifactContent: discoveryArtifact?.content ?? null,
      };
    });

    // STEP 2: The agentic loop
    await step.run("agent-loop", async () => {
      const { userId, executionId, nodeId } = event.data;
      const { projectId, files, messages, prompt, discoveryArtifactContent } = contextData;

      let iterations = 0;
      const MAX_ITERATIONS = Number(process.env.MAX_ITERATIONS) || 12;

      let currentContext = { currentTask: "", iteration: 0, scratchpad: [] as string[] };
      const toolHistory: Array<{
        role: "assistant" | "tool";
        content: string | null;
        tool_calls?: unknown[];
        tool_call_id?: string;
      }> = [];

      const promptEmbedding = await getEmbeddings(prompt);

      // Mark as running
      const execution = await prisma.execution.update({
        where: { id: executionId },
        data: { status: ExecutionStatus.RUNNING },
      });
      const node = await prisma.node.update({
        where: { id: nodeId },
        data: { status: NodeStatus.RUNNING },
      });
      await prisma.runtimeEvent.createMany({
        data: [
          { executionId, type: "execution.running", payload: { executionId } },
          { executionId, nodeId, type: "node.running", payload: { nodeId, type: NodeType.ARCHITECT } },
        ],
      });

      while (iterations < MAX_ITERATIONS) {
        iterations++;

        // Build context using the discovery artifact
        const request = await buildContext(
          projectId, files, messages, promptEmbedding, prompt, toolHistory, currentContext,
          discoveryArtifactContent as Record<string, unknown> | null
        );

        const response = await callLLM(request, tools);
        const message = response.choices[0].message;

        toolHistory.push({
          role: "assistant",
          content: message.content,
          tool_calls: message.tool_calls || undefined,
        });

        if (!message.tool_calls || message.tool_calls.length === 0) break;

        const tool_call = message.tool_calls[0];

        await prisma.runtimeEvent.create({
          data: {
            executionId, nodeId, type: "tool.called",
            payload: { tool: tool_call.function.name, args: JSON.parse(tool_call.function.arguments), iteration: iterations },
          },
        });

        if (tool_call.function.name === "mark_complete") {
          const args = JSON.parse(tool_call.function.arguments);
          await executeTool("mark_complete", args, projectId, userId, execution.id, node.id);
          await handleToolCompletion(executionId, nodeId, { tool: "mark_complete", result: "completed", iteration: iterations });
          break;
        }

        const args = JSON.parse(tool_call.function.arguments);
        const toolResult = await executeTool(tool_call.function.name, args, projectId, userId, execution.id, node.id);

        toolHistory.push({ role: "tool", content: toolResult, tool_call_id: tool_call.id });

        const shortLog = toolResult.length > 100 ? toolResult.substring(0, 100) + "..." : toolResult;
        await handleToolCompletion(executionId, nodeId, { tool: tool_call.function.name, result: shortLog, iteration: iterations });

        currentContext = {
          currentTask: prompt,
          iteration: iterations,
          scratchpad: [...currentContext.scratchpad, `[${iterations}]: ${tool_call.function.name}() -> ${shortLog}`],
        };
      }
    });

    // STEP 3: Finalize — flip project back to IDLE
    await step.run("finalize", async () => {
      await prisma.project.update({
        where: { id: contextData.projectId },
        data: { status: "IDLE" },
      });
    });
  }
);
