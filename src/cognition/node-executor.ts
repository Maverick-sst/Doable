import { ArtifactType, NodeStatus, NodeType, Prisma } from "@prisma/client";
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
import { getProviderCapabilities } from "@/src/providers";
import { handleToolCompletion } from "@/lib/toolCompletion";
import { validateArtifact } from "./types/artifact-validators";
import {
  markExecutionRunning,
  markNodeRunning,
} from "@/src/runtime/state/transitions";
import { resolveNodeBudget } from "@/src/runtime/budgets";
import { NodeConfig } from "./types/node-config";

export interface ExecuteNodeInput {
  projectId: string;
  userId: string;
  workflowId: string;
  executionId: string;
  nodeId: string;
  prompt: string;
  nodeConfig: NodeConfig;
  /**
   * Retained caller contract for compatibility. The Context Engine resolves
   * artifacts by policy, so this is not read here.
   */
  inputArtifactId?: string | null;
  /**
   * Orchestrator attempt number. Recorded on the node and in the running
   * event so a retry is visible as a distinct attempt, not a duplicate.
   */
  attempt?: number;
}

export interface ExecuteNodeResult {
  artifactId: string | null;
  /** True when the node stopped on a budget rather than finishing cleanly. */
  incomplete: boolean;
  nodeType: NodeType;
  workflowId: string;
  executionId: string;
  projectId: string;
  userId: string;
  prompt: string;
}

function cleanAndParseJSON(content: string, artifactType: ArtifactType) {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : content;
  const parsed = JSON.parse(jsonStr);
  return validateArtifact(artifactType, parsed);
}

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

async function markNodeCompleted(
  executionId: string,
  nodeId: string,
  nodeType: NodeType,
  artifactId: string | null,
) {
  const changed = await prisma.node.updateMany({
    where: { id: nodeId, status: { not: NodeStatus.COMPLETED } },
    data: { status: NodeStatus.COMPLETED, finishedAt: new Date() },
  });

  if (changed.count > 0) {
    await prisma.runtimeEvent.create({
      data: {
        executionId,
        nodeId,
        type: "node.completed",
        payload: { nodeId, type: nodeType, artifactId },
      },
    });
  }
}

/**
 * Semantic retrieval is optional. When the provider has no embedding endpoint
 * or the call fails, the node continues with no vector context instead of
 * failing the whole build.
 */
async function resolvePromptEmbedding(input: {
  prompt: string;
  enabled: boolean;
  executionId: string;
  nodeId: string;
  nodeType: NodeType;
}): Promise<number[]> {
  if (!input.enabled) return [];

  if (!getProviderCapabilities().embeddings) {
    await prisma.runtimeEvent.create({
      data: {
        executionId: input.executionId,
        nodeId: input.nodeId,
        type: "embeddings.skipped",
        payload: {
          nodeType: input.nodeType,
          reason: "provider_without_embeddings",
        },
      },
    });
    return [];
  }

  try {
    return await getEmbeddings(input.prompt);
  } catch (error) {
    await prisma.runtimeEvent.create({
      data: {
        executionId: input.executionId,
        nodeId: input.nodeId,
        type: "embeddings.skipped",
        payload: {
          nodeType: input.nodeType,
          reason: "embedding_failed",
          message: error instanceof Error ? error.message : "unknown",
        },
      },
    });
    return [];
  }
}

async function recordUsage(
  executionId: string,
  nodeId: string,
  nodeType: NodeType,
  response: Awaited<ReturnType<typeof callLLM>>,
) {
  await prisma.runtimeEvent.create({
    data: {
      executionId,
      nodeId,
      type: "model.usage",
      payload: {
        nodeType,
        provider: response.provider,
        model: response.model,
        promptTokens: response.usage?.promptTokens ?? null,
        completionTokens: response.usage?.completionTokens ?? null,
        totalTokens: response.usage?.totalTokens ?? null,
      },
    },
  });
}

async function markNodeIncomplete(
  executionId: string,
  nodeId: string,
  nodeType: NodeType,
  reason: string,
  detail: Record<string, unknown>,
) {
  const changed = await prisma.node.updateMany({
    where: { id: nodeId, status: { not: NodeStatus.COMPLETED } },
    data: {
      status: NodeStatus.INCOMPLETE,
      failureReason: reason,
      finishedAt: new Date(),
    },
  });

  if (changed.count > 0) {
    await prisma.runtimeEvent.create({
      data: {
        executionId,
        nodeId,
        type: "node.budget_exhausted",
        payload: { nodeId, type: nodeType, reason, ...detail },
      },
    });
  }
}

export async function executeNode(
  input: ExecuteNodeInput,
): Promise<ExecuteNodeResult> {
  const { projectId, executionId, nodeId, prompt, nodeConfig } = input;

  // `execution.running` is emitted only on the CREATED -> RUNNING
  // transition, so an activity retry cannot duplicate it.
  const executionStarted = await markExecutionRunning(executionId);
  await markNodeRunning(executionId, nodeId, input.attempt);

  const runningEvents: Prisma.RuntimeEventCreateManyInput[] = [];
  if (executionStarted > 0) {
    runningEvents.push({
      executionId,
      type: "execution.running",
      payload: { executionId },
    });
  }
  runningEvents.push({
    executionId,
    nodeId,
    type: "node.running",
    payload: {
      nodeId,
      type: nodeConfig.nodeType,
      attempt: input.attempt ?? 1,
    },
  });
  await prisma.runtimeEvent.createMany({ data: runningEvents });

  let artifactId: string | null = null;

  if (nodeConfig.outputMode === "structured_json") {
    const promptEmbedding = await resolvePromptEmbedding({
      prompt,
      enabled: nodeConfig.contextConfig.includeVectorSearch,
      executionId,
      nodeId,
      nodeType: nodeConfig.nodeType,
    });

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
        const response = await callLLM(messages, [], {
          responseFormat: "json",
        });
        await recordUsage(executionId, nodeId, nodeConfig.nodeType, response);
        const content = response.content ?? "";
        if (!content.trim()) throw new Error("LLM returned an empty response");
        parsedContent = cleanAndParseJSON(
          content,
          nodeConfig.outputArtifactType as ArtifactType,
        );
        break;
      } catch (error) {
        attempts++;
        if (attempts >= 3) {
          throw new Error(
            `Failed to parse/validate JSON output for ${nodeConfig.nodeType} after 3 attempts: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        messages.push({
          role: "user",
          content: `Your previous response was not valid JSON or did not match the required schema. Error: ${
            error instanceof Error ? error.message : String(error)
          }. Return ONLY the valid JSON object with no surrounding text.`,
        });
      }
    }

    const existing = await prisma.artifact.findUnique({ where: { nodeId } });
    if (existing) {
      artifactId = existing.id;
    } else if (nodeConfig.outputArtifactType && parsedContent) {
      const artifact = await createArtifact({
        projectId,
        workflowId: input.workflowId,
        executionId,
        nodeId,
        type: nodeConfig.outputArtifactType,
        producedBy: nodeConfig.nodeType,
        content: parsedContent,
        validationStatus: "VALID",
      });
      artifactId = artifact.id;
    }

    await markNodeCompleted(executionId, nodeId, nodeConfig.nodeType, artifactId);
  } else {
    let iterations = 0;
    const budget = resolveNodeBudget(nodeConfig.outputMode);
    const maxIterations = nodeConfig.maxIterations || budget.maxIterations;
    const startedAt = Date.now();
    const currentContext = {
      currentTask: prompt,
      iteration: 0,
      scratchpad: [] as string[],
    };
    const toolHistory: Array<{
      role: "assistant" | "tool";
      content: string | null;
      tool_calls?: unknown[];
      tool_call_id?: string;
    }> = [];

    const promptEmbedding = await resolvePromptEmbedding({
      prompt,
      enabled: nodeConfig.contextConfig.includeVectorSearch,
      executionId,
      nodeId,
      nodeType: nodeConfig.nodeType,
    });

    let markedComplete = false;
    let budgetExhausted = false;

    while (iterations < maxIterations) {
      if (Date.now() - startedAt >= budget.wallClockMs) {
        budgetExhausted = true;
        break;
      }
      iterations++;
      const request = await requestNodeContext(
        { projectId, executionId, nodeId },
        nodeConfig,
        prompt,
        { toolHistory, currentContext, promptEmbedding },
      );

      const response = await callLLM(request, tools);
      await recordUsage(executionId, nodeId, nodeConfig.nodeType, response);
      if (!response.content && response.toolCalls.length === 0) break;

      toolHistory.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      });

      if (response.toolCalls.length === 0) break;

      for (const toolCall of response.toolCalls) {
        let args: Record<string, string>;
        try {
          args = JSON.parse(toolCall.arguments) as Record<string, string>;
        } catch {
          toolHistory.push({
            role: "tool",
            content: "Error: tool arguments were not valid JSON",
            tool_call_id: toolCall.id,
          });
          continue;
        }

        await prisma.runtimeEvent.create({
          data: {
            executionId,
            nodeId,
            type: "tool.called",
            payload: {
              tool: toolCall.name,
              iteration: iterations,
            },
          },
        });

        if (toolCall.name === "mark_complete") {
          await executeTool(
            "mark_complete",
            args,
            projectId,
            input.userId,
            executionId,
            nodeId,
            iterations,
          );
          await handleToolCompletion(executionId, nodeId, {
            tool: "mark_complete",
            result: "completed",
            iteration: iterations,
          });
          toolHistory.push({
            role: "tool",
            content: "completed",
            tool_call_id: toolCall.id,
          });
          markedComplete = true;
          break;
        }

        const toolResult = await executeTool(
          toolCall.name,
          args,
          projectId,
          input.userId,
          executionId,
          nodeId,
          iterations,
        );
        toolHistory.push({
          role: "tool",
          content: toolResult,
          tool_call_id: toolCall.id,
        });

        const shortLog =
          toolResult.length > 100
            ? `${toolResult.substring(0, 100)}...`
            : toolResult;
        await handleToolCompletion(executionId, nodeId, {
          tool: toolCall.name,
          result: shortLog,
          iteration: iterations,
        });
        currentContext.scratchpad.push(
          `[${iterations}]: ${toolCall.name}() -> ${shortLog}`,
        );
      }

      if (markedComplete) break;
    }

    const elapsedMs = Date.now() - startedAt;

    if (!markedComplete) {
      if (budgetExhausted || iterations >= maxIterations) {
        // Work was produced but the budget bound it. That is neither success
        // nor failure: report it honestly and keep the work.
        await markNodeIncomplete(
          executionId,
          nodeId,
          nodeConfig.nodeType,
          `Stopped on budget after ${iterations} iterations (${Math.round(elapsedMs / 1000)}s) without mark_complete`,
          {
            iterations,
            maxIterations,
            elapsedMs,
            wallClockMs: budget.wallClockMs,
            reason: budgetExhausted ? "wall_clock" : "iterations",
          },
        );
        return {
          artifactId: null,
          incomplete: true,
          nodeType: nodeConfig.nodeType,
          workflowId: input.workflowId,
          executionId,
          projectId,
          userId: input.userId,
          prompt,
        };
      }

      throw new Error(
        `${nodeConfig.nodeType} stopped without calling mark_complete`,
      );
    }

    await markNodeCompleted(executionId, nodeId, nodeConfig.nodeType, null);
  }

  return {
    artifactId,
    incomplete: false,
    nodeType: nodeConfig.nodeType,
    workflowId: input.workflowId,
    executionId,
    projectId,
    userId: input.userId,
    prompt,
  };
}