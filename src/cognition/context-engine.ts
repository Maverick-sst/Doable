import { prisma } from "@/lib/prisma";
import { LLmMessage, RelevantFile } from "@/src/shared/types";
import { SYSTEM_PROMPT } from "./system-prompt";

export async function buildContext(
  projectId: string,
  files: { id: string; path: string; embeddingStatus: string }[],
  messages: { role: string; content: string }[],
  promptEmbedding: number[],
  prompt: string,
  toolHistory: Array<{
    role: "assistant" | "tool";
    content: string | null;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }> = [],
  currentContext: {
    currentTask: string;
    iteration: number;
    scratchpad: string[];
  },
  discoveryArtifact?: Record<string, unknown> | null
): Promise<LLmMessage[]> {

  // Fetch long-term memory via vector search
  const promptEmbeddingString = `[${promptEmbedding.join(",")}]`;
  const longTermMem = await prisma.$queryRaw<RelevantFile[]>`
    SELECT id, path, content FROM "File" 
    WHERE "projectId" = ${projectId}
      AND "embeddingStatus" = 'EMBEDDING_SUCCESSFUL'
    ORDER BY embedding <=> ${promptEmbeddingString}::vector 
    LIMIT 5`;

  // Build project context section from artifact (not ProjectMemory)
  const artifactContext = discoveryArtifact
    ? `
=== PROJECT REQUIREMENTS (from Discovery) ===
Domain: ${(discoveryArtifact.projectIntent as Record<string, string>)?.domain ?? "Unknown"}
Summary: ${(discoveryArtifact.projectIntent as Record<string, string>)?.summary ?? ""}
Features: ${((discoveryArtifact.coreFeatures as string[]) ?? []).join(", ")}
Tech Stack: ${JSON.stringify(discoveryArtifact.techStack ?? {})}
Data Entities: ${((discoveryArtifact.dataEntities as string[]) ?? []).join(", ")}
Auth: ${((discoveryArtifact.authRequirements as string[]) ?? []).join(", ")}
`
    : "=== PROJECT REQUIREMENTS ===\nNo discovery artifact found. Build a sensible default React app.";

  const contextMessages: LLmMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `
${artifactContext}

=== CURRENT TASK ===
${currentContext.currentTask || prompt}

=== FILE TREE ===
${files.length > 0 ? files.map((f) => f.path).join("\n") : "No files yet!"}

=== RELEVANT FILES ===
${longTermMem.length > 0
          ? longTermMem.map((f) => `[${f.path}]\n${f.content.slice(0, 700)}${f.content.length > 700 ? "..." : ""}`).join("\n---\n")
          : "No relevant files found yet."
        }

=== RECENT SCRATCHPAD (last 8 steps) ===
${currentContext.scratchpad.slice(-8).join("\n") || "No previous steps yet"}
      `.trim(),
    },
    // Past BUILD conversation history
    ...messages.map((m) => ({
      role: m.role.toLowerCase() as "user" | "assistant",
      content: m.content,
    } as LLmMessage)),
    // Tool history
    ...toolHistory.flatMap((entry): LLmMessage[] => {
      if (entry.role === "assistant" && entry.tool_calls && entry.tool_calls.length > 0) {
        return [{ role: "assistant", content: null, tool_calls: entry.tool_calls as never[] }];
      } else if (entry.role === "tool" && entry.tool_call_id) {
        return [{ role: "tool", content: entry.content || "(no output)", tool_call_id: entry.tool_call_id }];
      }
      return [{ role: "assistant", content: entry.content || "" }];
    }),
    { role: "user", content: prompt },
  ];

  return contextMessages;
}
