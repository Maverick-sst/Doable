import type { LLmMessage } from "@/src/shared/types";
import type { ChatResult } from "@/src/providers";
import { estimateUsageCost } from "@/src/providers/cost";
import {
  AgentTurnOutputError,
  type AgentToolHistoryEntry,
  type AgentTurnOutcome,
  type RunAgentTurnInput,
} from "./types";

/** A mis-shaped structured reply is retried, then reported as a failure. */
const MAX_STRUCTURED_ATTEMPTS = 3;

async function emitUsage(
  input: RunAgentTurnInput,
  response: ChatResult,
  latencyMs: number,
): Promise<void> {
  const cost = estimateUsageCost(response.usage);
  await input.onEvent?.({
    type: "model.usage",
    payload: {
      provider: response.provider,
      model: response.model,
      promptTokens: response.usage?.promptTokens ?? null,
      completionTokens: response.usage?.completionTokens ?? null,
      totalTokens: response.usage?.totalTokens ?? null,
      cachedPromptTokens: response.usage?.cachedPromptTokens ?? null,
      promptCacheSource:
        response.usage?.cachedPromptTokens !== undefined
          ? "provider"
          : "unsupported",
      latencyMs,
      usageSource: response.usage ? "provider" : "unavailable",
      estimatedCostUsd: cost.totalCostUsd,
      costSource: cost.configured ? "configured_flat_rate" : "unconfigured",
    },
  });
}

/**
 * Structured-output turn: model → schema validation → retry with the error,
 * bounded at three attempts. No tools, no partial success; the caller decides
 * what to persist once the output is valid.
 */
async function runStructuredTurn(
  input: RunAgentTurnInput,
  startedAt: number,
): Promise<AgentTurnOutcome> {
  if (!input.validateOutput) {
    throw new Error("structured_json turn requires a validateOutput adapter");
  }
  const now = input.now ?? Date.now;
  const messages: LLmMessage[] = [...input.messages];
  let failures = 0;

  while (failures < MAX_STRUCTURED_ATTEMPTS) {
    const callStarted = now();
    const response = await input.model.call({
      messages,
      tools: [],
      responseFormat: "json",
    });
    await emitUsage(input, response, now() - callStarted);

    const content = response.content ?? "";
    try {
      if (!content.trim()) throw new Error("LLM returned an empty response");
      const output = input.validateOutput(content);
      return {
        status: "completed",
        output,
        iterations: failures + 1,
        elapsedMs: now() - startedAt,
        toolHistory: [],
      };
    } catch (error) {
      failures++;
      if (failures >= MAX_STRUCTURED_ATTEMPTS) {
        throw new AgentTurnOutputError(
          "structured_json",
          MAX_STRUCTURED_ATTEMPTS,
          error instanceof Error ? error.message : String(error),
        );
      }
      messages.push({
        role: "user",
        content: `Your previous response was not valid JSON or did not match the required schema. Error: ${
          error instanceof Error ? error.message : String(error)
        }. Return ONLY the valid JSON object with no surrounding text.`,
      });
    }
  }

  // The loop either returns or throws; this guards future edits.
  throw new AgentTurnOutputError(
    "structured_json",
    MAX_STRUCTURED_ATTEMPTS,
    "no output",
  );
}

function parseToolArguments(raw: string): Record<string, string> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, string>;
  } catch {
    return null;
  }
}

function shortLog(content: string): string {
  return content.length > 100 ? `${content.substring(0, 100)}...` : content;
}

/**
 * Tool turn: model → tool authorization → execution → persistence hooks →
 * continue. The model only ever sees tools the configuration allows, and an
 * unlisted call is denied even if the model emits it anyway.
 */
async function runToolTurn(
  input: RunAgentTurnInput,
  startedAt: number,
): Promise<AgentTurnOutcome> {
  const now = input.now ?? Date.now;
  const maxIterations = Math.max(1, input.maxIterations ?? 1);
  const wallClockMs = input.wallClockMs ?? Number.POSITIVE_INFINITY;
  const eligible = new Set(input.config.toolPolicy.eligibleTools);
  const allowedTools = (input.tools ?? []).filter((tool) =>
    eligible.has(tool.function.name),
  );
  const toolHistory: AgentToolHistoryEntry[] = [];
  const scratchpad: string[] = [];
  let iterations = 0;

  while (iterations < maxIterations) {
    if (now() - startedAt >= wallClockMs) {
      return {
        status: "incomplete",
        reason: "wall_clock",
        iterations,
        elapsedMs: now() - startedAt,
        toolHistory,
      };
    }
    iterations++;

    const messages = input.nextMessages
      ? await input.nextMessages({ toolHistory, iteration: iterations, scratchpad })
      : input.messages;

    const callStarted = now();
    const response = await input.model.call({ messages, tools: allowedTools });
    await emitUsage(input, response, now() - callStarted);

    if (!response.content && response.toolCalls.length === 0) {
      return {
        status: "stopped",
        iterations,
        elapsedMs: now() - startedAt,
        toolHistory,
      };
    }

    toolHistory.push({
      role: "assistant",
      content: response.content,
      tool_calls: response.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    });

    if (response.toolCalls.length === 0) {
      return {
        status: "stopped",
        iterations,
        elapsedMs: now() - startedAt,
        toolHistory,
      };
    }

    let completed = false;

    for (const toolCall of response.toolCalls) {
      if (!eligible.has(toolCall.name)) {
        // Authorization is server-side: a model cannot widen its own policy.
        await input.onEvent?.({
          type: "tool.denied",
          payload: {
            tool: toolCall.name,
            iteration: iterations,
            reason: "not_eligible",
          },
        });
        toolHistory.push({
          role: "tool",
          content: `Error: tool "${toolCall.name}" is not permitted for this agent`,
          tool_call_id: toolCall.id,
        });
        continue;
      }

      const args = parseToolArguments(toolCall.arguments);
      if (!args) {
        toolHistory.push({
          role: "tool",
          content: "Error: tool arguments were not valid JSON",
          tool_call_id: toolCall.id,
        });
        continue;
      }

      await input.onEvent?.({
        type: "tool.called",
        payload: { tool: toolCall.name, iteration: iterations },
      });

      if (!input.toolRunner) {
        throw new Error("tool_calls turn requires a toolRunner adapter");
      }
      const result = await input.toolRunner.execute({
        name: toolCall.name,
        arguments: args,
        iteration: iterations,
      });

      toolHistory.push({
        role: "tool",
        content: result.content,
        tool_call_id: toolCall.id,
      });
      scratchpad.push(
        `[${iterations}]: ${toolCall.name}() -> ${shortLog(result.content)}`,
      );

      if (result.completesTurn) {
        completed = true;
        break;
      }
    }

    if (completed) {
      return {
        status: "completed",
        output: null,
        iterations,
        elapsedMs: now() - startedAt,
        toolHistory,
      };
    }
  }

  return {
    status: "incomplete",
    reason: "iterations",
    iterations,
    elapsedMs: now() - startedAt,
    toolHistory,
  };
}

/**
 * The single reusable agent turn. Callers supply adapters; the turn owns
 * output validation, tool authorization, iteration/wall-clock bounds, and the
 * continue/ask/finish decision. Trusted identity is never an input here — it
 * is injected by the adapters that execute model and tool calls.
 */
export async function runAgentTurn(
  input: RunAgentTurnInput,
): Promise<AgentTurnOutcome> {
  const now = input.now ?? Date.now;
  const startedAt = now();

  return input.mode === "structured_json"
    ? runStructuredTurn(input, startedAt)
    : runToolTurn(input, startedAt);
}
