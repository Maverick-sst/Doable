import type { ArtifactType } from "@prisma/client";
import type { LLmMessage } from "@/src/shared/types";
import type { ContextConfig } from "@/src/cognition/types/node-config";
import type { AgentType } from "@/src/hcr/agent-config";

/**
 * Context policy is configuration, not retrieval implementation: it states
 * which categories the agent may request. Adopted verbatim from the existing
 * `ContextConfig` (no duplicate representation) until the Context Engine V2
 * selection model replaces the binary flags.
 */
export type ContextPolicy = ContextConfig;

/**
 * Request shape for context assembly. Uses only existing IDs; the policy
 * travels with the request so future selection can be per-execution without
 * touching agent configuration.
 */
export interface ContextRequest {
  projectId: string;
  executionId?: string;
  nodeId?: string;
  agentType: AgentType;
  task: string;
  prompt: string;
  policy: ContextPolicy;
}

/**
 * Model-facing result. Kept structurally identical to what `buildNodeContext`
 * returns today (`LLmMessage[]`) so the runtime needs no changes.
 */
export interface ContextResult {
  messages: LLmMessage[];
}

/** One consumed artifact, already resolved to display form. */
export interface ResolvedArtifact {
  type: ArtifactType;
  version: number;
  content: unknown;
}

/** One semantically retrieved file, already truncated for injection. */
export interface RelevantFileContext {
  path: string;
  snippet: string;
}

/** Caller-owned inputs that stay outside the engine in this extraction. */
export interface CallerContextInputs {
  files: Array<{ id: string; path: string; embeddingStatus: string }>;
  messages: Array<{ role: string; content: string }>;
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
  promptEmbedding: number[];
}
