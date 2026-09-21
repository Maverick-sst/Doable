import type { LLmMessage } from "@/src/shared/types";
import type {
  CallerContextInputs,
  ContextPolicy,
  RelevantFileContext,
  ResolvedArtifact,
} from "./types";

export interface AssembleContextInput extends CallerContextInputs {
  systemPrompt: string;
  prompt: string;
  policy: ContextPolicy;
  outputMode: "structured_json" | "tool_calls";
  artifacts: ResolvedArtifact[];
  relevantFiles: RelevantFileContext[];
}

/**
 * Pure context assembly: the rendering half of `buildNodeContext`, moved
 * without semantic change. Same section headers, same flags, same budgets
 * (last-8 scratchpad), same message ordering
 * `[system, user-blob, ...history, ...toolMessages, user(prompt)]`.
 * No I/O here — all retrieval happens before this call.
 */
export function assembleContext(input: AssembleContextInput): LLmMessage[] {
  const {
    systemPrompt,
    prompt,
    policy,
    outputMode,
    artifacts,
    relevantFiles,
    files,
    messages,
    toolHistory,
    currentContext,
    promptEmbedding,
  } = input;

  const consumedArtifactsContent = artifacts.map(
    (artifact) => `
=== PROJECT ${artifact.type} (Version ${artifact.version}) ===
${JSON.stringify(artifact.content, null, 2)}
`,
  );

  let fileTreeContext = "";
  if (policy.includeFileTree) {
    fileTreeContext = `
=== FILE TREE ===
${files.length > 0 ? files.map((f) => f.path).join("\n") : "No files yet!"}
`;
  }

  // Preserves the original gate exactly: the section renders only when the
  // flag is on AND a prompt embedding exists; otherwise nothing is emitted
  // (not even the "no files" placeholder).
  let relevantFilesContext = "";
  if (policy.includeVectorSearch && promptEmbedding.length > 0) {
    relevantFilesContext = `
=== RELEVANT FILES ===
${relevantFiles.length > 0
      ? relevantFiles
          .map((f) => `[${f.path}]\n${f.snippet}`)
          .join("\n---\n")
      : "No relevant files found yet."
    }
`;
  }

  const historyMessages =
    policy.includeMessageHistory
      ? messages.map(
          (m) =>
            ({
              role: m.role.toLowerCase() as "user" | "assistant",
              content: m.content,
            }) as LLmMessage,
        )
      : [];

  const scratchpadContext =
    outputMode === "tool_calls"
      ? `
=== RECENT SCRATCHPAD (last 8 steps) ===
${currentContext.scratchpad.slice(-8).join("\n") || "No previous steps yet"}
`
      : "";

  const toolMessages =
    outputMode === "tool_calls"
      ? toolHistory.flatMap((entry): LLmMessage[] => {
          if (
            entry.role === "assistant" &&
            entry.tool_calls &&
            entry.tool_calls.length > 0
          ) {
            return [
              {
                role: "assistant",
                content: null,
                tool_calls: entry.tool_calls as never[],
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

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
    ...historyMessages,
    ...toolMessages,
    { role: "user", content: prompt },
  ];
}
