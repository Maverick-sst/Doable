import type { ChatResult, ToolDefinition } from "@/src/providers";
import type { AgentConfig } from "@/src/hcr/agent-config";
import type { LLmMessage } from "@/src/shared/types";

export type AgentTurnMode = "structured_json" | "tool_calls";

/** Assistant/tool messages produced by a turn; the context engine consumes them. */
export type AgentToolHistoryEntry =
  | { role: "assistant"; content: string | null; tool_calls?: unknown[] }
  | { role: "tool"; content: string; tool_call_id: string };

/** State handed back to the caller so it can rebuild context between turns. */
export interface AgentTurnToolContext {
  toolHistory: AgentToolHistoryEntry[];
  iteration: number;
  scratchpad: string[];
}

export interface AgentTurnModelCall {
  messages: LLmMessage[];
  tools: readonly ToolDefinition[];
  responseFormat?: "text" | "json";
}

/**
 * Model adapter. The turn never imports a provider, so a fake adapter can
 * drive the loop in tests without network access or credentials.
 */
export interface AgentTurnModel {
  call(input: AgentTurnModelCall): Promise<ChatResult>;
}

export interface AgentTurnToolExecution {
  content: string;
  /** True for the completion tool (`mark_complete`). */
  completesTurn?: boolean;
}

export interface AgentTurnToolRunner {
  execute(input: {
    name: string;
    arguments: Record<string, string>;
    iteration: number;
  }): Promise<AgentTurnToolExecution>;
}

/**
 * Persistence/telemetry adapters receive safe metadata only. Payloads must
 * not contain prompts, model output, or file contents.
 */
export type AgentTurnEvent =
  | { type: "model.usage"; payload: Record<string, unknown> }
  | { type: "tool.called"; payload: { tool: string; iteration: number } }
  | {
      type: "tool.denied";
      payload: { tool: string; iteration: number; reason: string };
    };

export interface RunAgentTurnInput {
  /** Effective configuration; owns instructions, policy, and tool eligibility. */
  config: AgentConfig;
  mode: AgentTurnMode;
  /** Context assembled before the turn starts. */
  messages: LLmMessage[];
  /** Full model-facing tool catalog. Eligibility is applied inside the turn. */
  tools?: readonly ToolDefinition[];
  maxIterations?: number;
  /** `Infinity` disables the wall-clock bound (structured turns). */
  wallClockMs?: number;
  model: AgentTurnModel;
  toolRunner?: AgentTurnToolRunner;
  /** Rebuilds messages between tool iterations (needed for fresh context). */
  nextMessages?: (state: AgentTurnToolContext) => Promise<LLmMessage[]>;
  /** Schema validation for structured output; throws on invalid content. */
  validateOutput?: (content: string) => Record<string, unknown>;
  onEvent?: (event: AgentTurnEvent) => Promise<void>;
  now?: () => number;
}

interface AgentTurnOutcomeBase {
  iterations: number;
  elapsedMs: number;
  toolHistory: AgentToolHistoryEntry[];
}

export type AgentTurnOutcome =
  | (AgentTurnOutcomeBase & {
      status: "completed";
      output: Record<string, unknown> | null;
    })
  | (AgentTurnOutcomeBase & {
      status: "incomplete";
      reason: "iterations" | "wall_clock";
    })
  | (AgentTurnOutcomeBase & { status: "stopped" });

/** Model output could not be parsed/validated within the retry bound. */
export class AgentTurnOutputError extends Error {
  constructor(mode: AgentTurnMode, attempts: number, cause: string) {
    super(
      `Failed to parse/validate ${mode} output after ${attempts} attempts: ${cause}`,
    );
    this.name = "AgentTurnOutputError";
  }
}
