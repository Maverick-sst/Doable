import { prisma } from "./prisma";
import { LLmMessage, RelevantFile } from "./types";
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
    currentTask: string,
    iteration: number,
    scratchpad: string[]
  }
): Promise<LLmMessage[]> {
  const shortTermMem = await prisma.projectMemory.findFirst({
    where: { id: projectId },
    select: {
      domain: true,
      requirements: true,
      techStack: true,
      summary: true
    },
  });


  const promptEmbeddingString = `[${promptEmbedding.join(",")}]`;

  const longTermMem = await prisma.$queryRaw<RelevantFile[]>`
    SELECT id, path, content FROM "File" 
    WHERE "projectId" = ${projectId}
      AND "embeddingStatus" = 'EMBEDDING_SUCCESSFUL'
    ORDER BY embedding <=> ${promptEmbeddingString}::vector 
    LIMIT 5`;

  const contextMessages: LLmMessage[] = [
    // 1. System message
    { role: "system", content: SYSTEM_PROMPT },

    // 2. Project Context + State
    {
      role: "user",
      content: `
=== PROJECT DETAILS ===
domain : ${shortTermMem?.domain}, techstack: ${shortTermMem?.techStack}, requirements: ${shortTermMem?.requirements}

=== PROJECT SUMMARY ===
${shortTermMem?.summary || "New project - starting fresh"}

=== CURRENT TASK ===
${currentContext.currentTask || prompt}

=== FILE TREE ===
${files.length > 0 ? files.map((f) => f.path).join("\n") : "No files yet!"}

=== RELEVANT FILES ===
${longTermMem.length > 0
          ? longTermMem
            .map(
              (f) => `
[${f.path}]
${f.content.slice(0, 700)}${f.content.length > 700 ? "..." : ""}
      `,
            )
            .join("\n---\n")
          : "No relevant files found yet."
        }

=== RECENT SCRATCHPAD (last 8 steps) ===
${currentContext.scratchpad.slice(-8).join("\n") || "No previous steps yet"}
      `.trim(),
    },

    // 3. Past conversation history
    ...messages.map(
      (m) =>
        ({
          role: m.role.toLowerCase() as "user" | "assistant",
          content: m.content,
        }) as LLmMessage,
    ),

    // 4. Tool History (Critical for multi-turn tool calling)
    ...toolHistory.flatMap((entry): LLmMessage[] => {
      if (
        entry.role === "assistant" &&
        entry.tool_calls &&
        entry.tool_calls.length > 0
      ) {
        return [
          {
            role: "assistant",
            content: null,
            tool_calls: entry.tool_calls as never[], // we'll refine this later
          },
        ];
      } else if (entry.role === "tool" && entry.tool_call_id) {
        return [
          {
            role: "tool",
            content: entry.content || "(no output)",
            tool_call_id: entry.tool_call_id,
          },
        ];
      }
      // fallback for simple assistant messages
      return [
        {
          role: "assistant",
          content: entry.content || "",
        },
      ];
    }),

    // 5. Current user prompt
    { role: "user", content: prompt },
  ];

  return contextMessages;
}
