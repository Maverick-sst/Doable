import type { ArtifactType } from "@prisma/client";
import { sha256 } from "@/src/hcr/agent-config/hash";
import { pinnedFactMessageIds } from "./facts";
import type {
  ContextBudgetReport,
  ContextFact,
  ContextFacts,
  ContextPolicy,
  ContextSection,
  ContextSourceReference,
  FailureContext,
  HistoryMessage,
  MemoryContext,
  ProjectFileEntry,
  RelevantFileContext,
  ResolvedArtifact,
  ToolHistoryEntry,
  VerificationContext,
} from "./types";

/** Rough but deterministic token estimate; no tokenizer dependency. */
export const CHARS_PER_TOKEN = 4;
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 60_000;
export const MAX_FILE_TREE_ENTRIES = 200;
/** Fixed allowance for section headers and separators. */
const FRAMING_OVERHEAD_TOKENS = 24;

export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface SelectionInput {
  limitTokens: number;
  systemPrompt: string;
  prompt: string;
  task: string;
  policy: ContextPolicy;
  artifacts: ResolvedArtifact[];
  missingArtifactTypes: ArtifactType[];
  facts: ContextFacts;
  files: ProjectFileEntry[];
  relevantFiles: RelevantFileContext[];
  verification: VerificationContext[];
  failures: FailureContext[];
  memories: MemoryContext[];
  messages: HistoryMessage[];
  toolHistory: ToolHistoryEntry[];
  scratchpad: string[];
}

export interface ContextSelection {
  artifacts: ResolvedArtifact[];
  facts: ContextFacts;
  files: ProjectFileEntry[];
  relevantFiles: RelevantFileContext[];
  verification: VerificationContext[];
  failures: FailureContext[];
  memories: MemoryContext[];
  messages: HistoryMessage[];
  toolHistory: ToolHistoryEntry[];
  scratchpad: string[];
  sources: ContextSourceReference[];
  notes: string[];
  budget: ContextBudgetReport;
}

interface Meter {
  limit: number;
  used: number;
  overflow: boolean;
  compacted: boolean;
  omitted: Partial<Record<ContextSection, number>>;
}

function charge(meter: Meter, tokens: number, required = false): boolean {
  if (meter.used + tokens <= meter.limit) {
    meter.used += tokens;
    return true;
  }
  if (required) {
    // Required sources are never silently truncated; report the overflow.
    meter.used += tokens;
    meter.overflow = true;
    return true;
  }
  return false;
}

function omit(meter: Meter, section: ContextSection, count = 1): void {
  meter.omitted[section] = (meter.omitted[section] ?? 0) + count;
  meter.compacted = true;
}

function ref(
  source: Omit<ContextSourceReference, "inclusion"> & {
    inclusion?: ContextSourceReference["inclusion"];
  },
): ContextSourceReference {
  return { inclusion: "included", ...source };
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function factLabel(fact: ContextFact): string {
  return `message ${shortId(fact.messageId)}`;
}

function allFacts(facts: ContextFacts): ContextFact[] {
  return [
    ...(facts.intent ? [facts.intent] : []),
    ...facts.unresolvedQuestions,
    ...facts.pendingApprovals,
  ];
}

function dedupeById<T extends { id: string }>(items: T[]): {
  kept: T[];
  duplicates: T[];
} {
  const seen = new Set<string>();
  const kept: T[] = [];
  const duplicates: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      duplicates.push(item);
    } else {
      seen.add(item.id);
      kept.push(item);
    }
  }
  return { kept, duplicates };
}

function dedupeByPath(files: RelevantFileContext[]): {
  kept: RelevantFileContext[];
  duplicates: RelevantFileContext[];
} {
  const seen = new Set<string>();
  const kept: RelevantFileContext[] = [];
  const duplicates: RelevantFileContext[] = [];
  for (const file of files) {
    if (seen.has(file.path)) {
      duplicates.push(file);
    } else {
      seen.add(file.path);
      kept.push(file);
    }
  }
  return { kept, duplicates };
}

function toolEntryTokens(entry: ToolHistoryEntry): number {
  return estimateTokens(
    `${entry.content ?? ""}${JSON.stringify(entry.tool_calls ?? [])}`,
  );
}

/**
 * Drops tool results whose assistant call did not survive the budget. Sending
 * an orphan `tool` message is an invalid provider request.
 */
function pruneOrphanToolResults(
  entries: ToolHistoryEntry[],
): ToolHistoryEntry[] {
  const callIds = new Set<string>();
  const kept: ToolHistoryEntry[] = [];
  for (const entry of entries) {
    if (entry.role === "assistant") {
      for (const call of entry.tool_calls ?? []) {
        const id = (call as { id?: unknown }).id;
        if (typeof id === "string") callIds.add(id);
      }
      kept.push(entry);
      continue;
    }
    if (entry.tool_call_id && callIds.has(entry.tool_call_id)) {
      kept.push(entry);
    }
  }
  return kept;
}

function notesFor(meter: Meter, missing: ArtifactType[], stale: number): string[] {
  const notes: string[] = [];
  for (const type of missing) {
    notes.push(`Missing context source: ${type}.`);
  }
  if (stale > 0) {
    notes.push(
      `${stale} verification report(s) predate the latest workspace change and are marked stale.`,
    );
  }
  if (meter.overflow) {
    notes.push(
      `Required context exceeds the ${meter.limit}-token budget by ${meter.used - meter.limit} tokens; required sources were kept in full.`,
    );
  }
  const omitted = meter.omitted;
  if (omitted.message) {
    notes.push(
      `${omitted.message} earlier message(s) omitted to fit the context budget; intent, unresolved questions, and pending approvals are preserved above.`,
    );
  }
  if (omitted["tool-history"]) {
    notes.push(
      `${omitted["tool-history"]} earlier tool step(s) omitted to fit the context budget.`,
    );
  }
  if (omitted.scratchpad) {
    notes.push(
      `${omitted.scratchpad} earlier scratchpad step(s) omitted.`,
    );
  }
  const sourceSections: ContextSection[] = [
    "relevant-file",
    "verification",
    "failure",
    "memory",
    "file-tree",
  ];
  for (const section of sourceSections) {
    const count = omitted[section];
    if (count) {
      notes.push(
        `${count} ${section} source(s) omitted to fit the context budget.`,
      );
    }
  }
  return notes;
}

/**
 * Deterministic selection and compaction. Required sources are charged first
 * and never truncated; everything else is admitted newest/most-relevant first
 * until the budget is exhausted. The result carries enough provenance to
 * explain every inclusion and omission.
 */
export function selectContext(input: SelectionInput): ContextSelection {
  const meter: Meter = {
    limit: input.limitTokens,
    used: 0,
    overflow: false,
    compacted: false,
    omitted: {},
  };
  const sources: ContextSourceReference[] = [];

  // Fixed, always-required framing.
  charge(meter, estimateTokens(input.systemPrompt), true);
  charge(meter, estimateTokens(input.prompt), true);
  charge(meter, estimateTokens(input.task), true);
  charge(meter, FRAMING_OVERHEAD_TOKENS, true);

  // Consumed artifacts: required and complete.
  for (const artifact of input.artifacts) {
    charge(
      meter,
      estimateTokens(JSON.stringify(artifact.content, null, 2)),
      true,
    );
    sources.push(
      ref({
        kind: "artifact",
        id: artifact.id,
        label: `${artifact.type} v${artifact.version}`,
        version: artifact.version,
        updatedAt: artifact.createdAt,
        status: "available",
        priority: "required",
      }),
    );
  }
  for (const type of input.missingArtifactTypes) {
    sources.push(
      ref({
        kind: "artifact",
        label: type,
        status: "missing",
        priority: "required",
        inclusion: "dropped",
        reason: "missing",
      }),
    );
  }

  // Pinned conversation facts: required, small, and never compacted away.
  for (const fact of allFacts(input.facts)) {
    charge(meter, estimateTokens(fact.content), true);
    sources.push(
      ref({
        kind: "message",
        id: fact.messageId,
        label: factLabel(fact),
        updatedAt: fact.createdAt,
        status: "available",
        priority: "required",
      }),
    );
  }

  // Relevant sources, in order of operational value.
  const verification: VerificationContext[] = [];
  for (const report of input.verification) {
    const tokens = estimateTokens(
      `${report.status} ${report.command ?? ""} ${report.outputSnippet ?? ""}`,
    );
    if (charge(meter, tokens)) {
      verification.push(report);
      sources.push(
        ref({
          kind: "verification",
          id: report.id,
          label: `${report.status} verification`,
          updatedAt: report.createdAt,
          status: report.stale ? "stale" : "available",
          priority: "relevant",
        }),
      );
    } else {
      omit(meter, "verification");
      sources.push(
        ref({
          kind: "verification",
          id: report.id,
          label: `${report.status} verification`,
          updatedAt: report.createdAt,
          status: report.stale ? "stale" : "available",
          priority: "relevant",
          inclusion: "dropped",
          reason: "budget",
        }),
      );
    }
  }

  const failures: FailureContext[] = [];
  for (const failure of input.failures) {
    const tokens = estimateTokens(
      `${failure.nodeType} ${failure.status} ${failure.failureReason}`,
    );
    if (charge(meter, tokens)) {
      failures.push(failure);
      sources.push(
        ref({
          kind: "failure",
          id: failure.nodeId,
          label: `${failure.nodeType} ${failure.status}`,
          updatedAt: failure.finishedAt ?? undefined,
          status: "available",
          priority: "relevant",
        }),
      );
    } else {
      omit(meter, "failure");
      sources.push(
        ref({
          kind: "failure",
          id: failure.nodeId,
          label: `${failure.nodeType} ${failure.status}`,
          updatedAt: failure.finishedAt ?? undefined,
          status: "available",
          priority: "relevant",
          inclusion: "dropped",
          reason: "budget",
        }),
      );
    }
  }

  const memories: MemoryContext[] = [];
  for (const memory of input.memories) {
    const tokens = estimateTokens(`[${memory.kind}] ${memory.subject}: ${memory.content}`);
    const label = `${memory.kind.toLowerCase()}: ${memory.subject}`;
    if (charge(meter, tokens)) {
      memories.push(memory);
      sources.push(
        ref({
          kind: "memory",
          id: memory.id,
          label,
          updatedAt: memory.updatedAt,
          status: "available",
          priority: "relevant",
        }),
      );
    } else {
      omit(meter, "memory");
      sources.push(
        ref({
          kind: "memory",
          id: memory.id,
          label,
          updatedAt: memory.updatedAt,
          status: "available",
          priority: "relevant",
          inclusion: "dropped",
          reason: "budget",
        }),
      );
    }
  }

  const relevantDedupe = dedupeByPath(input.relevantFiles);
  for (const duplicate of relevantDedupe.duplicates) {
    sources.push(
      ref({
        kind: "relevant-file",
        id: duplicate.id,
        label: duplicate.path,
        updatedAt: duplicate.updatedAt,
        status: "available",
        priority: "relevant",
        inclusion: "dropped",
        reason: "duplicate",
      }),
    );
  }
  const relevantFiles: RelevantFileContext[] = [];
  for (const file of relevantDedupe.kept) {
    if (charge(meter, estimateTokens(`${file.path}${file.snippet}`))) {
      relevantFiles.push(file);
      sources.push(
        ref({
          kind: "relevant-file",
          id: file.id,
          label: file.path,
          updatedAt: file.updatedAt,
          status: "available",
          priority: "relevant",
        }),
      );
    } else {
      omit(meter, "relevant-file");
      sources.push(
        ref({
          kind: "relevant-file",
          id: file.id,
          label: file.path,
          updatedAt: file.updatedAt,
          status: "available",
          priority: "relevant",
          inclusion: "dropped",
          reason: "budget",
        }),
      );
    }
  }

  // File tree is one cheap aggregate; it is capped by count, not by entry.
  const treeEntries = Math.min(input.files.length, MAX_FILE_TREE_ENTRIES);
  const treeTokens =
    estimateTokens(input.files.slice(0, treeEntries).map((f) => f.path).join("\n")) +
    FRAMING_OVERHEAD_TOKENS;
  let files: ProjectFileEntry[] = [];
  if (input.files.length > 0 && charge(meter, treeTokens)) {
    files = input.files.slice(0, treeEntries);
    sources.push(
      ref({
        kind: "file",
        id: "file-tree",
        label: `file tree (${input.files.length} path(s))`,
        status: "available",
        priority: "relevant",
      }),
    );
  } else if (input.files.length > 0) {
    omit(meter, "file-tree");
    sources.push(
      ref({
        kind: "file",
        id: "file-tree",
        label: `file tree (${input.files.length} path(s))`,
        status: "available",
        priority: "relevant",
        inclusion: "dropped",
        reason: "budget",
      }),
    );
  }

  // Optional: newest tool steps first, then newest conversation messages.
  const toolEntries = [...input.toolHistory];
  const keptTool: ToolHistoryEntry[] = [];
  let droppedTool = 0;
  for (let i = toolEntries.length - 1; i >= 0; i--) {
    if (charge(meter, toolEntryTokens(toolEntries[i]))) {
      keptTool.push(toolEntries[i]);
    } else {
      droppedTool++;
    }
  }
  keptTool.reverse();
  // Only prune on a genuinely compacted history: a small caller-owned history
  // keeps its exact old shape, while a budget-trimmed one must not leave tool
  // results whose assistant call was dropped.
  const toolHistory =
    keptTool.length < input.toolHistory.length
      ? pruneOrphanToolResults(keptTool)
      : keptTool;
  const prunedByPairing = keptTool.length - toolHistory.length;
  if (droppedTool + prunedByPairing > 0) {
    omit(meter, "tool-history", droppedTool + prunedByPairing);
  }
  if (input.toolHistory.length > 0) {
    sources.push(
      ref({
        kind: "tool-history",
        id: "tool-history",
        label: `tool history (${toolHistory.length}/${input.toolHistory.length} entries)`,
        status: "available",
        priority: "optional",
      }),
    );
  }

  const pinned = pinnedFactMessageIds(input.facts);
  const historyDedupe = dedupeById(input.messages);
  for (const duplicate of historyDedupe.duplicates) {
    sources.push(
      ref({
        kind: "message",
        id: duplicate.id,
        label: `message ${shortId(duplicate.id)}`,
        updatedAt: duplicate.createdAt,
        status: "available",
        priority: "optional",
        inclusion: "dropped",
        reason: "duplicate",
      }),
    );
  }
  const candidateMessages = historyDedupe.kept.filter(
    (message) => !pinned.has(message.id),
  );
  const keptMessages: HistoryMessage[] = [];
  let droppedMessages = 0;
  for (let i = candidateMessages.length - 1; i >= 0; i--) {
    const message = candidateMessages[i];
    if (charge(meter, estimateTokens(message.content))) {
      keptMessages.push(message);
    } else {
      droppedMessages++;
    }
  }
  keptMessages.reverse();
  for (const message of keptMessages) {
    sources.push(
      ref({
        kind: "message",
        id: message.id,
        label: `message ${shortId(message.id)}`,
        updatedAt: message.createdAt,
        status: "available",
        priority: "optional",
      }),
    );
  }
  for (const message of candidateMessages.slice(0, droppedMessages)) {
    sources.push(
      ref({
        kind: "message",
        id: message.id,
        label: `message ${shortId(message.id)}`,
        updatedAt: message.createdAt,
        status: "available",
        priority: "optional",
        inclusion: "dropped",
        reason: "budget",
      }),
    );
  }
  if (droppedMessages > 0) {
    omit(meter, "message", droppedMessages);
  }

  const scratchpadWindow = input.scratchpad.slice(-8);
  const keptScratchpad: string[] = [];
  for (let i = scratchpadWindow.length - 1; i >= 0; i--) {
    if (charge(meter, estimateTokens(scratchpadWindow[i]))) {
      keptScratchpad.push(scratchpadWindow[i]);
    }
  }
  keptScratchpad.reverse();
  const droppedScratchpad = scratchpadWindow.length - keptScratchpad.length;
  if (droppedScratchpad > 0) {
    omit(meter, "scratchpad", droppedScratchpad);
  }
  if (input.scratchpad.length > 0) {
    sources.push(
      ref({
        kind: "scratchpad",
        id: "scratchpad",
        label: `scratchpad (${keptScratchpad.length} step(s))`,
        status: "available",
        priority: "optional",
      }),
    );
  }

  const staleVerification = verification.filter((report) => report.stale).length;

  return {
    artifacts: input.artifacts,
    facts: input.facts,
    files,
    relevantFiles,
    verification,
    failures,
    memories,
    messages: keptMessages,
    toolHistory,
    scratchpad: keptScratchpad,
    sources,
    notes: notesFor(meter, input.missingArtifactTypes, staleVerification),
    budget: {
      limitTokens: meter.limit,
      usedTokens: meter.used,
      overflow: meter.overflow,
      compacted: meter.compacted,
      omitted: meter.omitted,
    },
  };
}

/**
 * Content hash of the resolved selection. Uses only stable fields (no
 * timestamps of assembly), so the same durable state yields the same
 * fingerprint after a worker restart.
 */
export function fingerprintContext(input: {
  task: string;
  prompt: string;
  policy: ContextPolicy;
  limitTokens: number;
  facts: ContextFacts;
  sources: ContextSourceReference[];
}): string {
  const policy = input.policy;
  const payload = JSON.stringify({
    task: input.task,
    prompt: input.prompt,
    budget: input.limitTokens,
    policy: {
      consumedArtifactTypes: [...policy.consumedArtifactTypes].sort(),
      includeFileTree: policy.includeFileTree,
      includeVectorSearch: policy.includeVectorSearch,
      includeMessageHistory: policy.includeMessageHistory,
      includeVerification: policy.includeVerification === true,
      includeFailures: policy.includeFailures === true,
      includeMemory: policy.includeMemory === true,
      maxHistoryMessages: policy.maxHistoryMessages ?? null,
    },
    facts: {
      intent: input.facts.intent?.messageId ?? null,
      unresolved: input.facts.unresolvedQuestions.map((fact) => fact.messageId),
      approvals: input.facts.pendingApprovals.map((fact) => fact.messageId),
    },
    sources: input.sources.map((source) => [
      source.kind,
      source.id ?? "",
      source.label,
      source.version ?? null,
      source.status,
      source.inclusion,
      source.priority,
      source.reason ?? "",
    ]),
  });
  return sha256(payload);
}
