import { NodeConfig } from "./types/node-config";
import { ArtifactType, NodeType, NodeStatus, ExecutionStatus, MessagePhase } from "@prisma/client";
import { inngest } from "@/app/inngest/client";
import { prisma } from "@/lib/prisma";
import { callLLM } from "./llm";
import { buildNodeContext } from "./context-engine";
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
  inputArtifactId: string | null;
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

export async function executeNode(input: ExecuteNodeInput): Promise<ExecuteNodeResult> {
  const { projectId, userId, workflowId, executionId, nodeId, prompt, nodeConfig, inputArtifactId } = input;

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

  // 2. Fetch consumed artifacts
  let inputArtifactContent: Record<string, unknown> | null = null;
  if (inputArtifactId) {
    const inputArtifact = await prisma.artifact.findUnique({
      where: { id: inputArtifactId },
    });
    if (inputArtifact) {
      inputArtifactContent = inputArtifact.content as Record<string, unknown>;
    }
  } else if (nodeConfig.consumedArtifactTypes.length > 0) {
    const inputArtifact = await prisma.artifact.findFirst({
      where: {
        projectId,
        type: nodeConfig.consumedArtifactTypes[0],
      },
      orderBy: { version: "desc" },
    });
    if (inputArtifact) {
      inputArtifactContent = inputArtifact.content as Record<string, unknown>;
    }
  }

  let artifactId: string | null = null;

  if (nodeConfig.outputMode === "structured_json") {
    // 3. Structured JSON flow
    const promptEmbedding = await getEmbeddings(prompt);
    
    // Build context
    const contextMessages = await buildNodeContext({
      projectId,
      nodeConfig,
      prompt,
      promptEmbedding,
      files: [],
      messages: [],
      toolHistory: [],
      currentContext: { currentTask: prompt, iteration: 0, scratchpad: [] },
      inputArtifactContent,
    });

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

    // Fire inngest event
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
    
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        files: { select: { id: true, path: true, embeddingStatus: true } }
      }
    });
    const files = project?.files ?? [];

    const dbMessages = await prisma.message.findMany({
      where: { projectId, phase: MessagePhase.BUILD },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { role: true, content: true },
    });
    const reversedMessages = dbMessages.reverse();

    while (iterations < maxIterations) {
      iterations++;

      const request = await buildNodeContext({
        projectId,
        nodeConfig,
        prompt,
        promptEmbedding,
        files,
        messages: reversedMessages,
        toolHistory,
        currentContext,
        inputArtifactContent,
      });

      const response = await callLLM(request, tools);
      const message = response.choices[0]?.message;
      if (!message) break;

      toolHistory.push({
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls || undefined,
      });

      if (!message.tool_calls || message.tool_calls.length === 0) break;

      const tool_call = message.tool_calls[0];

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
        break;
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

      currentContext = {
        currentTask: prompt,
        iteration: iterations,
        scratchpad: [...currentContext.scratchpad, `[${iterations}]: ${tool_call.function.name}() -> ${shortLog}`],
      };
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
