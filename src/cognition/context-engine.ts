import { prisma } from "@/lib/prisma";
import { LLmMessage, RelevantFile } from "@/src/shared/types";
import { NodeConfig } from "./types/node-config";

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

  // 1. Fetch consumed artifacts
  const consumedArtifactsContent: string[] = [];
  if (nodeConfig.contextConfig.consumedArtifactTypes.length > 0) {
    for (const type of nodeConfig.contextConfig.consumedArtifactTypes) {
      const artifact = await prisma.artifact.findFirst({
        where: { projectId, type },
        orderBy: { version: "desc" },
      });
      if (artifact) {
        consumedArtifactsContent.push(`
=== PROJECT ${artifact.type} (Version ${artifact.version}) ===
${JSON.stringify(artifact.content, null, 2)}
`);
      }
    }
  }

  // 2. Build file tree context
  let fileTreeContext = "";
  if (nodeConfig.contextConfig.includeFileTree) {
    fileTreeContext = `
=== FILE TREE ===
${files.length > 0 ? files.map((f) => f.path).join("\n") : "No files yet!"}
`;
  }

  // 3. Build relevant files context from vector DB
  let relevantFilesContext = "";
  if (nodeConfig.contextConfig.includeVectorSearch && promptEmbedding.length > 0) {
    const promptEmbeddingString = `[${promptEmbedding.join(",")}]`;
    const longTermMem = await prisma.$queryRaw<RelevantFile[]>`
      SELECT id, path, content FROM "File" 
      WHERE "projectId" = ${projectId}
        AND "embeddingStatus" = 'EMBEDDING_SUCCESSFUL'
      ORDER BY embedding <=> ${promptEmbeddingString}::vector 
      LIMIT 5`;

    relevantFilesContext = `
=== RELEVANT FILES ===
${longTermMem.length > 0
      ? longTermMem.map((f) => `[${f.path}]\n${f.content.slice(0, 700)}${f.content.length > 700 ? "..." : ""}`).join("\n---\n")
      : "No relevant files found yet."
    }
`;
  }

  // 4. Build message history (only if config says so)
  const historyMessages = nodeConfig.contextConfig.includeMessageHistory
    ? messages.map((m) => ({
        role: m.role.toLowerCase() as "user" | "assistant",
        content: m.content,
      } as LLmMessage))
    : [];

  // 5. Build scratchpad and tool history for agentic loop
  const scratchpadContext = nodeConfig.outputMode === "tool_calls"
    ? `
=== RECENT SCRATCHPAD (last 8 steps) ===
${currentContext.scratchpad.slice(-8).join("\n") || "No previous steps yet"}
`
    : "";

  const toolMessages = nodeConfig.outputMode === "tool_calls"
    ? toolHistory.flatMap((entry): LLmMessage[] => {
        if (entry.role === "assistant" && entry.tool_calls && entry.tool_calls.length > 0) {
          return [{ role: "assistant", content: null, tool_calls: entry.tool_calls as never[] }];
        } else if (entry.role === "tool" && entry.tool_call_id) {
          return [{ role: "tool", content: entry.content || "(no output)", tool_call_id: entry.tool_call_id }];
        }
        return [{ role: "assistant", content: entry.content || "" }];
      })
    : [];

  const userContent = `
${consumedArtifactsContent.join("\n")}

=== CURRENT TASK ===
${currentContext.currentTask || prompt}
${fileTreeContext}
${relevantFilesContext}
${scratchpadContext}
  `.trim();

  const contextMessages: LLmMessage[] = [
    { role: "system", content: nodeConfig.systemPrompt },
    {
      role: "user",
      content: userContent,
    },
    ...historyMessages,
    ...toolMessages,
    { role: "user", content: prompt },
  ];

  return contextMessages;
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
