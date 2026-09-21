import { LLmMessage } from "@/src/shared/types";
import { NodeConfig } from "./types/node-config";
import { agentTypeForNode } from "@/src/hcr/agent-config";
import { buildContext as buildEngineContext } from "@/src/hcr/context-engine/engine";

export async function buildNodeContext(
  input: {
    projectId: string;
    nodeConfig: NodeConfig;
    prompt: string;
    promptEmbedding: number[];
    files: { id: string; path: string; embeddingStatus: string }[];
    messages: { role: string; content: string }[];
    toolHistory: Array<{
      role: "assistant" | "tool";
      content: string | null;
      tool_calls?: unknown[];
      tool_call_id?: string;
    }>;
    currentContext: {
      currentTask: string;
      iteration: number;
      scratchpad: string[];
    };
    inputArtifactContent: Record<string, unknown> | null;
  }
): Promise<LLmMessage[]> {
  const { projectId, nodeConfig, prompt, promptEmbedding, files, messages, toolHistory, currentContext } = input;

  // Compatibility facade over the runtime contract: same inputs in, same
  // LLmMessage[] out. `inputArtifactContent` stays accepted but unused
  // (Seam 1); removal is a separate cleanup step.
  const result = await buildEngineContext(
    {
      projectId,
      agentType: agentTypeForNode(nodeConfig.nodeType),
      task: currentContext.currentTask,
      prompt,
      policy: nodeConfig.contextConfig,
    },
    {
      files,
      messages,
      toolHistory,
      currentContext,
      promptEmbedding,
      systemPrompt: nodeConfig.systemPrompt,
      outputMode: nodeConfig.outputMode,
    },
  );

  return result.messages;
}

export async function buildContext(
  projectId: string,
  files: { id: string; path: string; embeddingStatus: string }[],
  messages: { role: string; content: string }[],
  promptEmbedding: number[],
  prompt: string,
  toolHistory: Array<{
    role: "assistant" | "tool";
    content: string | null;
    tool_calls?: any[];
    tool_call_id?: string;
  }>,
  currentContext: {
    currentTask: string;
    iteration: number;
    scratchpad: string[];
  },
  discoveryArtifactContent?: Record<string, unknown> | null
): Promise<LLmMessage[]> {
  const { AGENT_REGISTRY } = require("./agent-registry");
  const { NodeType } = require("@prisma/client");
  return buildNodeContext({
    projectId,
    nodeConfig: AGENT_REGISTRY[NodeType.ARCHITECT]!,
    prompt,
    promptEmbedding,
    files,
    messages,
    toolHistory,
    currentContext,
    inputArtifactContent: discoveryArtifactContent || null,
  });
}
