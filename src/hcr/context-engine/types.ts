import type { ArtifactType } from "@prisma/client";
import type { LLmMessage } from "@/src/shared/types";
import type { ContextConfig } from "@/src/cognition/types/node-config";
import type { AgentType } from "@/src/hcr/agent-config";

/**
 * Context policy is configuration, not retrieval implementation: it states
 * which categories the agent may request. The V2 flags are opt-in so existing
 * node contracts keep their exact context shape until a consumer needs them.
 */
export interface ContextPolicy extends ContextConfig {
  /** Include recent verification reports (status, command, bounded output). */
  includeVerification?: boolean;
  /** Include prior failed/incomplete node attempts for this project. */
  includeFailures?: boolean;
  /** Include curated project memory (summary, requirements, tech stack). */
  includeMemory?: boolean;
  /** Override how many BUILD-phase messages retrieval considers. */
  maxHistoryMessages?: number;
}

/** Request shape for context assembly. Uses only existing IDs. */
export interface ContextRequest {
  projectId: string;
  executionId?: string;
  nodeId?: string;
  agentType: AgentType;
  task: string;
  prompt: string;
  policy: ContextPolicy;
  /**
   * Hard ceiling for assembled context, in estimated tokens. Required
   * sources (system prompt, task, prompt, consumed artifacts, pinned facts)
   * are never truncated; relevant/optional sources are bounded.
   */
  budget?: ContextBudget;
}

export interface ContextBudget {
  limitTokens: number;
}

export type ContextSourceKind =
  | "artifact"
  | "file"
  | "relevant-file"
  | "message"
  | "verification"
  | "failure"
  | "memory"
  | "tool-history"
  | "scratchpad";

export type ContextSourceStatus = "available" | "stale" | "missing";
export type ContextSourceInclusion = "included" | "dropped";
export type ContextSourcePriority = "required" | "relevant" | "optional";

export type ContextDropReason = "budget" | "duplicate" | "missing" | "stale";

/**
 * One source the engine considered, whether or not it made it into the
 * prompt. This is the provenance record: labels are IDs/paths/type names,
 * never source content.
 */
export interface ContextSourceReference {
  kind: ContextSourceKind;
  id?: string;
  label: string;
  version?: number;
  updatedAt?: string;
  status: ContextSourceStatus;
  priority: ContextSourcePriority;
  inclusion: ContextSourceInclusion;
  reason?: ContextDropReason;
}

/** A fact that must survive compaction, with its originating message. */
export interface ContextFact {
  messageId: string;
  content: string;
  createdAt: string;
}

export interface ContextFacts {
  intent: ContextFact | null;
  unresolvedQuestions: ContextFact[];
  pendingApprovals: ContextFact[];
}

/** Sections that can be dropped by the budget, for the omission report. */
export type ContextSection = ContextSourceKind | "file-tree";

export interface ContextBudgetReport {
  limitTokens: number;
  usedTokens: number;
  /** True when required sources alone exceed the ceiling. */
  overflow: boolean;
  compacted: boolean;
  omitted: Partial<Record<ContextSection, number>>;
}

/**
 * Model-facing result plus provenance. `messages` keeps the existing shape;
 * the remaining fields describe how it was produced.
 */
export interface ContextResult {
  messages: LLmMessage[];
  sources: ContextSourceReference[];
  facts: ContextFacts;
  memories: MemoryContext[];
  budget: ContextBudgetReport;
  /** Deterministic hash of the resolved selection (no timestamps). */
  fingerprint: string;
}

/** One consumed artifact, already resolved to display form. */
export interface ResolvedArtifact {
  id?: string;
  type: ArtifactType;
  version: number;
  content: unknown;
  createdAt?: string;
}

/** One semantically retrieved file, already truncated for injection. */
export interface RelevantFileContext {
  id?: string;
  path: string;
  snippet: string;
  updatedAt?: string;
}

/** Project file entry as the file-tree section consumes it. */
export interface ProjectFileEntry {
  id: string;
  path: string;
  embeddingStatus: string;
  updatedAt?: string;
}

/** Raw history entry; role normalization stays in the assembler. */
export interface HistoryMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

/** A verification report, bounded for injection. */
export interface VerificationContext {
  id: string;
  status: string;
  command: string | null;
  exitCode: number | null;
  durationMs: number | null;
  outputSnippet: string | null;
  revision: string | null;
  createdAt: string;
  /** True when workspace files changed after this report was produced. */
  stale: boolean;
}

/** A prior failed or incomplete node attempt for this project. */
export interface FailureContext {
  nodeId: string;
  executionId: string;
  nodeType: string;
  status: string;
  failureReason: string;
  finishedAt: string | null;
}

/** One active layered-memory entry, ready for injection. */
export interface MemoryContext {
  id: string;
  kind: string;
  subject: string;
  content: string;
  confidence: number;
  updatedAt: string;
  sourceKind: string;
  sourceId: string | null;
}

/** Tool-loop entry shape shared by the caller and the engine. */
export interface ToolHistoryEntry {
  role: "assistant" | "tool";
  content: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

/** Caller-owned inputs that stay outside the engine. */
export interface CallerContextInputs {
  toolHistory: ToolHistoryEntry[];
  currentContext: {
    currentTask: string;
    iteration: number;
    scratchpad: string[];
  };
  promptEmbedding: number[];
  /**
   * Runtime-held agent configuration, passed explicitly so the engine never
   * imports the registry to discover prompts. The engine only receives the
   * two assembly-relevant values.
   */
  systemPrompt: string;
  outputMode: "structured_json" | "tool_calls";
}
