import type { ChatUsage } from "./types";

export interface UsageCost {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  /**
   * False when no rates are configured. Local inference is legitimately free,
   * so a zero estimate is not an error; the source says whether to trust it.
   */
  configured: boolean;
}

function ratePer1k(name: string): number {
  const parsed = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Optional flat-rate cost estimate. This is not provider billing: it applies
 * one input/output rate to every routed call, and is only as accurate as the
 * operator's configured rate. Unset rates report zero with `configured: false`.
 */
export function estimateUsageCost(usage?: ChatUsage): UsageCost {
  const inputRate = ratePer1k("MODEL_INPUT_COST_PER_1K_USD");
  const outputRate = ratePer1k("MODEL_OUTPUT_COST_PER_1K_USD");
  const configured = inputRate > 0 || outputRate > 0;
  const inputTokens = usage?.promptTokens ?? 0;
  const outputTokens = usage?.completionTokens ?? 0;
  const inputCostUsd = (inputTokens / 1_000) * inputRate;
  const outputCostUsd = (outputTokens / 1_000) * outputRate;
  return {
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
    configured,
  };
}
