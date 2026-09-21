import { NodeConfig } from "./types/node-config";
import { ArtifactType, NodeType, NodeStatus, ExecutionStatus } from "@prisma/client";
import { inngest } from "@/app/inngest/client";
import { prisma } from "@/lib/prisma";
import { callLLM } from "./llm";
import * as contextEngine from "@/src/hcr/context-engine/engine";
import { agentTypeForNode } from "@/src/hcr/agent-config";
import type { CallerContextInputs } from "@/src/hcr/context-engine";
import type { LLmMessage } from "@/src/shared/types";
import { createArtifact } from "@/src/runtime/artifacts/create-artifact";
import { executeTool } from "@/lib/tool-executor";
import { tools } from "@/lib/tools";
import { getEmbeddings } from "@/lib/embeddings";
import { handleToolCompletion } from "@/lib/toolCompletion";
import { validateArtifact } from "./types/artifact-validators";

export interface ExecuteNodeInput {
  projectId: string;
  userId: string;
  workflowId: string;
  executionId: string;
  nodeId: string;
  prompt: string;            // The original user prompt
  nodeConfig: NodeConfig;
  // Retained caller contract; the Context Engine re-resolves artifacts by
  // policy, so this is no longer read here (Seam 1 removed).
  inputArtifactId: string | null;
  // Temporal HCR migration boundary: when false, skip the Inngest
  // `node/completed` send so Temporal owns sequencing. Defaults true to
  // preserve existing Inngest behavior. See HCR_MIGRATION_MAP.md §4.
  emitCompletionEvent?: boolean;
}

export interface ExecuteNodeResult {
  artifactId: string | null;  // null if node produced file mutations
  nodeType: NodeType;
  workflowId: string;
  executionId: string;
  projectId: string;
  userId: string;
  prompt: string;
}

function cleanAndParseJSON(content: string, artifactType: ArtifactType) {
  // Try to extract JSON between { and } if there's preamble
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : content;
  const parsed = JSON.parse(jsonStr);
  return validateArtifact(artifactType, parsed);
}

// Runtime-to-engine seam: builds an explicit ContextRequest from the node's
// execution identity and configuration, passes caller-owned inputs through
// untouched, and returns the assembled messages. `task` carries the live
// current task (equal to `prompt` on first pass by existing caller
// behavior — see CONTEXT_MAP.md); the engine never reinterprets it.
async function requestNodeContext(
  identity: { projectId: string; executionId: string; nodeId: string },
  nodeConfig: NodeConfig,
  prompt: string,
  callerInputs: Omit<CallerContextInputs, "systemPrompt" | "outputMode">,
): Promise<LLmMessage[]> {
  const context = await contextEngine.buildContext(
    {
      projectId: identity.projectId,
      executionId: identity.executionId,
      nodeId: identity.nodeId,
      agentType: agentTypeForNode(nodeConfig.nodeType),
      task: callerInputs.currentContext.currentTask,
      prompt,
      policy: nodeConfig.contextConfig,
    },
    {
      ...callerInputs,
      systemPrompt: nodeConfig.systemPrompt,
      outputMode: nodeConfig.outputMode,
    },
  );
  return context.messages;
}

export async function executeNode(input: ExecuteNodeInput): Promise<ExecuteNodeResult> {
  const { projectId, userId, workflowId, executionId, nodeId, prompt, nodeConfig } = input;
  const emitCompletionEvent = input.emitCompletionEvent ?? true;

  // 1. Mark node/execution RUNNING + emit events
  await prisma.execution.update({
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
      { executionId, nodeId, type: "node.running", payload: { nodeId, type: nodeConfig.nodeType } },
    ],
  });

  // 2. Consumed-artifact resolution moved behind the Context Engine, which
  // re-queries by policy (Seam 1 removed; the unread pass-through is gone).

  let artifactId: string | null = null;

  if (nodeConfig.outputMode === "structured_json") {
    // 3. Structured JSON flow
    const promptEmbedding = await getEmbeddings(prompt);
    
    // Build context through the Context Engine runtime contract
    const contextMessages = await requestNodeContext(
      { projectId, executionId, nodeId },
      nodeConfig,
      prompt,
      {
        toolHistory: [],
        currentContext: { currentTask: prompt, iteration: 0, scratchpad: [] },
        promptEmbedding,
      },
    );

    let attempts = 0;
    let parsedContent: Record<string, unknown> | null = null;
    const messages = [...contextMessages];

    while (attempts < 3) {
      try {
        const response = await callLLM(messages, []);
        const content = response.choices[0]?.message?.content || "";
        parsedContent = cleanAndParseJSON(content, nodeConfig.outputArtifactType!);
        break;
      } catch (err) {
        attempts++;
        if (attempts >= 3) {
          throw new Error(`Failed to parse/validate JSON output for ${nodeConfig.nodeType} after 3 attempts: ${(err as Error).message}`);
        }
        messages.push({
          role: "user",
          content: `Your previous response was not valid JSON or did not match the required schema. Error: ${(err as Error).message}. Return ONLY the valid JSON object with no surrounding text.`
        });
      }
    }

    // Check if artifact already exists for this nodeId (idempotency check)
    const existing = await prisma.artifact.findFirst({ where: { nodeId } });
    if (existing) {
      artifactId = existing.id;
    } else if (nodeConfig.outputArtifactType && parsedContent) {
      const artifact = await createArtifact({
        projectId,
        workflowId,
        executionId,
        nodeId,
        type: nodeConfig.outputArtifactType,
        producedBy: nodeConfig.nodeType,
        content: parsedContent,
      });
      artifactId = artifact.id;
    }

    // Mark node COMPLETED
    await prisma.node.update({
      where: { id: nodeId },
      data: { status: NodeStatus.COMPLETED },
    });

    await prisma.runtimeEvent.create({
      data: {
        executionId,
        nodeId,
        type: "node.completed",
        payload: { nodeId, type: nodeConfig.nodeType },
      },
    });

    // Fire inngest event (skipped when Temporal owns sequencing).
    if (emitCompletionEvent) {
      await inngest.send({
        name: "node/completed",
        data: {
          projectId,
          userId,
          workflowId,
          executionId,
          nodeType: nodeConfig.nodeType,
          outputArtifactId: artifactId,
          outputArtifactType: nodeConfig.outputArtifactType,
          prompt,
        },
      });
    }

  } else {
    // 4. Tool call flow (FE/BE)
    let iterations = 0;
    const maxIterations = nodeConfig.maxIterations || 20;

    let currentContext = { currentTask: prompt, iteration: 0, scratchpad: [] as string[] };
    const toolHistory: Array<{
      role: "assistant" | "tool";
      content: string | null;
      tool_calls?: unknown[];
      tool_call_id?: string;
    }> = [];

    const promptEmbedding = await getEmbeddings(prompt);

    while (iterations < maxIterations) {
      iterations++;

      const request = await requestNodeContext(
        { projectId, executionId, nodeId },
        nodeConfig,
        prompt,
        {
          toolHistory,
          currentContext,
          promptEmbedding,
        },
      );

      const response = await callLLM(request, tools);
      const message = response.choices?.[0]?.message;
      if (!message) break;

      toolHistory.push({
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls || undefined,
      });

      if (!message.tool_calls || message.tool_calls.length === 0) break;

      let shouldBreak = false;

      for (const tool_call of message.tool_calls) {
        await prisma.runtimeEvent.create({
          data: {
            executionId,
            nodeId,
            type: "tool.called",
            payload: {
              tool: tool_call.function.name,
              args: JSON.parse(tool_call.function.arguments),
              iteration: iterations,
            },
          },
        });

        if (tool_call.function.name === "mark_complete") {
          const args = JSON.parse(tool_call.function.arguments);
          await executeTool("mark_complete", args, projectId, userId, executionId, nodeId);
          await handleToolCompletion(executionId, nodeId, {
            tool: "mark_complete",
            result: "completed",
            iteration: iterations,
          });
          toolHistory.push({ role: "tool", content: "completed", tool_call_id: tool_call.id });
          shouldBreak = true;
          continue;
        }

        const args = JSON.parse(tool_call.function.arguments);
        const toolResult = await executeTool(tool_call.function.name, args, projectId, userId, executionId, nodeId);

        toolHistory.push({ role: "tool", content: toolResult, tool_call_id: tool_call.id });

        const shortLog = toolResult.length > 100 ? toolResult.substring(0, 100) + "..." : toolResult;
        await handleToolCompletion(executionId, nodeId, {
          tool: tool_call.function.name,
          result: shortLog,
          iteration: iterations,
        });

        currentContext.scratchpad.push(`[${iterations}]: ${tool_call.function.name}() -> ${shortLog}`);
      }

      if (shouldBreak) break;
    }

    // Verify node completed status and trigger completed event
    const nodeState = await prisma.node.findUnique({
      where: { id: nodeId },
    });

    if (nodeState && nodeState.status !== NodeStatus.COMPLETED) {
      await prisma.node.update({
        where: { id: nodeId },
        data: { status: NodeStatus.COMPLETED },
      });

      await prisma.runtimeEvent.create({
        data: {
          executionId,
          nodeId,
          type: "node.completed",
          payload: { nodeId, type: nodeConfig.nodeType },
        },
      });
    }

    if (emitCompletionEvent) {
      await inngest.send({
        name: "node/completed",
        data: {
          projectId,
          userId,
          workflowId,
          executionId,
          nodeType: nodeConfig.nodeType,
          outputArtifactId: null,
          outputArtifactType: null,
          prompt,
        },
      });
    }
  }

  return {
    artifactId,
    nodeType: nodeConfig.nodeType,
    workflowId,
    executionId,
    projectId,
    userId,
    prompt,
  };
}
