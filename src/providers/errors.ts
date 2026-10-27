/**
 * Provider error taxonomy. The router uses it to decide whether a failure is
 * retryable/fallback-able; messages never include prompts or credentials.
 */
export type ProviderErrorCategory =
  | "auth"
  | "rate_limit"
  | "timeout"
  | "transport"
  | "invalid_request"
  | "server"
  | "unknown";

export function classifyProviderError(error: unknown): ProviderErrorCategory {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();

  if (
    message.includes("api key") ||
    message.includes("not configured") ||
    message.includes("unauthorized") ||
    message.includes("401") ||
    message.includes("403")
  ) {
    return "auth";
  }
  if (message.includes("429") || message.includes("rate limit")) {
    return "rate_limit";
  }
  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("aborted")
  ) {
    return "timeout";
  }
  if (
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("network") ||
    message.includes("socket")
  ) {
    return "transport";
  }
  if (
    message.includes("400") ||
    message.includes("422") ||
    message.includes("invalid request") ||
    message.includes("tool") && message.includes("not supported")
  ) {
    return "invalid_request";
  }
  if (
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504")
  ) {
    return "server";
  }
  return "unknown";
}

export function isRetryableCategory(
  category: ProviderErrorCategory,
): boolean {
  return (
    category === "rate_limit" ||
    category === "timeout" ||
    category === "transport" ||
    category === "server"
  );
}

export class NoEligibleModelError extends Error {
  readonly candidates: Array<{ id: string; reason: string }>;

  constructor(candidates: Array<{ id: string; reason: string }>) {
    const summary = candidates
      .map((candidate) => `${candidate.id}: ${candidate.reason}`)
      .join("; ");
    super(
      `No eligible model for this request. ${summary || "Catalog is empty."}`,
    );
    this.name = "NoEligibleModelError";
    this.candidates = candidates;
  }
}

export class ProviderUnavailableError extends Error {
  readonly category: ProviderErrorCategory;
  readonly attempts: number;
  readonly modelsTried: string[];

  constructor(
    category: ProviderErrorCategory,
    attempts: number,
    modelsTried: string[],
  ) {
    super(
      `Model request failed after ${attempts} attempt(s) (${category}). Tried: ${modelsTried.join(
        ", ",
      )}`,
    );
    this.name = "ProviderUnavailableError";
    this.category = category;
    this.attempts = attempts;
    this.modelsTried = modelsTried;
  }
}

export class ContextWindowExceededError extends Error {
  readonly modelId: string;
  readonly estimatedTokens: number;
  readonly maxPromptTokens: number;

  constructor(
    modelId: string,
    estimatedTokens: number,
    maxPromptTokens: number,
  ) {
    super(
      `Context exceeds model window for ${modelId}: ~${estimatedTokens} tokens > ${maxPromptTokens} available`,
    );
    this.name = "ContextWindowExceededError";
    this.modelId = modelId;
    this.estimatedTokens = estimatedTokens;
    this.maxPromptTokens = maxPromptTokens;
  }
}
