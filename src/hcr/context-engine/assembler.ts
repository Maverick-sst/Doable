import type { LLmMessage } from "@/src/shared/types";
import { MAX_FILE_TREE_ENTRIES } from "./selection";
import type {
  CallerContextInputs,
  ContextFact,
  ContextFacts,
  ContextPolicy,
  HistoryMessage,
  ProjectFileEntry,
  RelevantFileContext,
  ResolvedArtifact,
} from "./types";

export interface AssembleContextInput extends CallerContextInputs {
  systemPrompt: string;
  prompt: string;
  /**
   * Authoritative task, resolved by the engine (`request.task`, falling back
   * to `request.prompt`). The assembler renders it verbatim and never picks
   * between competing task sources itself (§8).
   */
  task: string;
  /** Engine-resolved file index (replaces former caller-supplied list). */
  files: ProjectFileEntry[];
  /** Engine-resolved history (replaces former caller-supplied list). */
  messages: HistoryMessage[];
  policy: ContextPolicy;
  outputMode: "structured_json" | "tool_calls";
  artifacts: ResolvedArtifact[];
  relevantFiles: RelevantFileContext[];
  /** Facts that must survive compaction (V2). */
  facts?: ContextFacts;
  /** Compaction/availability notes (V2). */
  notes?: string[];
}

function renderFact(label: string, fact: ContextFact): string {
  return `- ${label} [message ${fact.messageId}]: ${fact.content}`;
}

function factsSection(facts: ContextFacts | undefined): string {
  if (!facts) return "";
  const lines: string[] = [];
  if (facts.intent) lines.push(renderFact("Intent", facts.intent));
  if (facts.unresolvedQuestions.length > 0) {
    lines.push("Unresolved questions:");
    for (const fact of facts.unresolvedQuestions) {
      lines.push(renderFact("", fact));
    }
  }
  if (facts.pendingApprovals.length > 0) {
    lines.push("Pending approvals:");
    for (const fact of facts.pendingApprovals) {
      lines.push(renderFact("", fact));
    }
  }
  if (lines.length === 0) return "";
  return `
=== CONVERSATION FACTS ===
${lines.join("\n")}
`;
}

function notesSection(notes: string[] | undefined): string {
  if (!notes || notes.length === 0) return "";
  return `
=== CONTEXT NOTES ===
${notes.map((note) => `- ${note}`).join("\n")}
`;
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
    task,
    policy,
    outputMode,
    artifacts,
    files,
    relevantFiles,
    messages,
    toolHistory,
    currentContext,
    promptEmbedding,
    facts,
    notes,
  } = input;

  const consumedArtifactsContent = artifacts.map(
    (artifact) => `
=== PROJECT ${artifact.type} (Version ${artifact.version}) ===
${JSON.stringify(artifact.content, null, 2)}
`,
  );

  let fileTreeContext = "";
  if (policy.includeFileTree) {
    const shown = files.slice(0, MAX_FILE_TREE_ENTRIES);
    const omitted = files.length - shown.length;
    const listing =
      files.length > 0
        ? `${shown.map((f) => f.path).join("\n")}${
            omitted > 0 ? `\n... and ${omitted} more file(s)` : ""
          }`
        : "No files yet!";
    fileTreeContext = `
=== FILE TREE ===
${listing}
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
${task}
${fileTreeContext}
${relevantFilesContext}
${scratchpadContext}
${factsSection(facts)}
${notesSection(notes)}
  `.trim();

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
    ...historyMessages,
    ...toolMessages,
    { role: "user", content: prompt },
  ];
}
