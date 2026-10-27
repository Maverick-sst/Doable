import { ArtifactType, NodeStatus, NodeType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { callLLM } from "./llm";
import * as contextEngine from "@/src/hcr/context-engine/engine";
import {
  agentTypeForNode,
  agentConfigProvider,
  hashAgentConfig,
} from "@/src/hcr/agent-config";
import type { AgentConfig } from "@/src/hcr/agent-config";
import { runAgentTurn } from "@/src/hcr/agent-turn";
import type { AgentTurnEvent } from "@/src/hcr/agent-turn";
import type { CallerContextInputs, ContextResult } from "@/src/hcr/context-engine";
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
import { resolveContextBudget, resolveNodeBudget } from "@/src/runtime/budgets";
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
): Promise<ContextResult> {
  const context = await contextEngine.buildContext(
    {
      projectId: identity.projectId,
      executionId: identity.executionId,
      nodeId: identity.nodeId,
      agentType: agentTypeForNode(nodeConfig.nodeType),
      task: callerInputs.currentContext.currentTask,
      prompt,
      policy: nodeConfig.contextConfig,
      budget: { limitTokens: resolveContextBudget() },
    },
    {
      ...callerInputs,
      systemPrompt: nodeConfig.systemPrompt,
      outputMode: nodeConfig.outputMode,
    },
  );

  // Provenance only: kinds, labels, statuses, counts. No source content.
  await prisma.runtimeEvent.create({
    data: {
      executionId: identity.executionId,
      nodeId: identity.nodeId,
      type: "context.assembled",
      payload: {
        nodeType: nodeConfig.nodeType,
        fingerprint: context.fingerprint,
        // Budget is a plain record; the cast satisfies Prisma's JSON input.
        budget: context.budget as unknown as Prisma.InputJsonValue,
        sources: context.sources.map((source) => ({
          kind: source.kind,
          label: source.label,
          status: source.status,
          inclusion: source.inclusion,
          reason: source.reason ?? null,
        })),
      },
    },
  });

  return context;
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

async function recordAgentTurnEvent(
  executionId: string,
  nodeId: string,
  nodeType: NodeType,
  event: AgentTurnEvent,
) {
  await prisma.runtimeEvent.create({
    data: {
      executionId,
      nodeId,
      type: event.type,
      payload: { nodeType, ...event.payload },
    },
  });
}

/**
 * Resolve and validate the effective configuration before any model call.
 * Provider resolution validates, so an invalid catalog fails at the boundary
 * rather than mid-turn.
 */
async function resolveAgentConfig(nodeType: NodeType): Promise<AgentConfig> {
  return agentConfigProvider.resolve({
    agentType: agentTypeForNode(nodeType),
  });
}

/**
 * Records the exact configuration a run used. The hash covers the prompt
 * content, so version + hash reproduce the instructions even if the catalog
 * later changes.
 */
async function recordAgentConfig(
  nodeId: string,
  config: AgentConfig,
): Promise<string> {
  const hash = hashAgentConfig(config);
  await prisma.node.update({
    where: { id: nodeId },
    data: { agentConfigVersion: config.version, agentConfigHash: hash },
  });
  return hash;
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

  // Resolve and record configuration before any model call: an invalid
  // catalog fails before spending tokens, and the node is reproducible.
  const agentConfig = await resolveAgentConfig(nodeConfig.nodeType);

  // `execution.running` is emitted only on the CREATED -> RUNNING
  // transition, so an activity retry cannot duplicate it.
  const executionStarted = await markExecutionRunning(executionId);
  await markNodeRunning(executionId, nodeId, input.attempt);
  const agentConfigHash = await recordAgentConfig(nodeId, agentConfig);

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
      agentConfigVersion: agentConfig.version,
      agentConfigHash,
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

    const outcome = await runAgentTurn({
      config: agentConfig,
      mode: "structured_json",
      messages: contextMessages.messages,
      model: {
        call: ({ messages, tools: turnTools, responseFormat }) =>
          callLLM(messages, turnTools, { responseFormat }),
      },
      validateOutput: (content) =>
        cleanAndParseJSON(
          content,
          nodeConfig.outputArtifactType as ArtifactType,
        ),
      onEvent: (event) =>
        recordAgentTurnEvent(executionId, nodeId, nodeConfig.nodeType, event),
    });

    if (outcome.status !== "completed") {
      throw new Error(
        `${nodeConfig.nodeType} structured turn did not complete`,
      );
    }

    const parsedContent = outcome.output;

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
    const budget = resolveNodeBudget(nodeConfig.outputMode);
    const maxIterations = nodeConfig.maxIterations || budget.maxIterations;

    const promptEmbedding = await resolvePromptEmbedding({
      prompt,
      enabled: nodeConfig.contextConfig.includeVectorSearch,
      executionId,
      nodeId,
      nodeType: nodeConfig.nodeType,
    });

    const outcome = await runAgentTurn({
      config: agentConfig,
      mode: "tool_calls",
      messages: [],
      tools,
      maxIterations,
      wallClockMs: budget.wallClockMs,
      model: {
        call: ({ messages, tools: turnTools }) =>
          callLLM(messages, turnTools),
      },
      nextMessages: async ({ toolHistory, iteration, scratchpad }) =>
        (
          await requestNodeContext(
            { projectId, executionId, nodeId },
            nodeConfig,
            prompt,
            {
              toolHistory,
              currentContext: { currentTask: prompt, iteration, scratchpad },
              promptEmbedding,
            },
          )
        ).messages,
      toolRunner: {
        execute: async ({ name, arguments: args, iteration }) => {
          if (name === "mark_complete") {
            await executeTool(
              "mark_complete",
              args,
              projectId,
              input.userId,
              executionId,
              nodeId,
              iteration,
            );
            await handleToolCompletion(executionId, nodeId, {
              tool: "mark_complete",
              result: "completed",
              iteration,
            });
            return { content: "completed", completesTurn: true };
          }

          const toolResult = await executeTool(
            name,
            args,
            projectId,
            input.userId,
            executionId,
            nodeId,
            iteration,
          );
          const shortLog =
            toolResult.length > 100
              ? `${toolResult.substring(0, 100)}...`
              : toolResult;
          await handleToolCompletion(executionId, nodeId, {
            tool: name,
            result: shortLog,
            iteration,
          });
          return { content: toolResult };
        },
      },
      onEvent: (event) =>
        recordAgentTurnEvent(executionId, nodeId, nodeConfig.nodeType, event),
    });

    if (outcome.status === "incomplete") {
      // Work was produced but the budget bound it. That is neither success
      // nor failure: report it honestly and keep the work.
      await markNodeIncomplete(
        executionId,
        nodeId,
        nodeConfig.nodeType,
        `Stopped on budget after ${outcome.iterations} iterations (${Math.round(
          outcome.elapsedMs / 1000,
        )}s) without mark_complete`,
        {
          iterations: outcome.iterations,
          maxIterations,
          elapsedMs: outcome.elapsedMs,
          wallClockMs: budget.wallClockMs,
          reason: outcome.reason,
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

    if (outcome.status !== "completed") {
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