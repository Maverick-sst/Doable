import { LLmMessage } from "@/src/shared/types";
import { NodeConfig } from "./types/node-config";
import { retrieveArtifacts } from "@/src/hcr/context-engine/retrievers/artifacts";
import { retrieveRelevantFiles } from "@/src/hcr/context-engine/retrievers/relevant-files";
import { assembleContext } from "@/src/hcr/context-engine/assembler";

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

  // Thin orchestrator over the extracted boundary: retrieval first (engine-
  // owned queries), then pure assembly. Ordering, flags, budgets, and output
  // shape are preserved exactly — see src/hcr/context-engine/CONTEXT_MAP.md.
  // `inputArtifactContent` stays accepted but unused (Seam 1); removal is a
  // separate cleanup step.
  const artifacts =
    nodeConfig.contextConfig.consumedArtifactTypes.length > 0
      ? await retrieveArtifacts(
          projectId,
          nodeConfig.contextConfig.consumedArtifactTypes,
        )
      : [];

  const relevantFiles = nodeConfig.contextConfig.includeVectorSearch
    ? await retrieveRelevantFiles(projectId, promptEmbedding)
    : [];

  return assembleContext({
    systemPrompt: nodeConfig.systemPrompt,
    prompt,
    policy: nodeConfig.contextConfig,
    outputMode: nodeConfig.outputMode,
    artifacts,
    relevantFiles,
    files,
    messages,
    toolHistory,
    currentContext,
    promptEmbedding,
  });
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
