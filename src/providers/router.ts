import type { ChatRequest, ChatResult, EmbeddingRequest } from "./types";
import {
  getDefaultModelDescriptor,
  getModelDescriptor,
  listModelDescriptors,
  type ModelDescriptor,
} from "./catalog";
import {
  classifyProviderError,
  isRetryableCategory,
  NoEligibleModelError,
  ProviderUnavailableError,
  type ProviderErrorCategory,
} from "./errors";
import {
  isProviderAvailable,
  recordProviderFailure,
  recordProviderSuccess,
} from "./health";
import { getProviderById } from "./registry";

export type RouteTaskProfile = "reasoning" | "planning" | "implementation";

export interface RouteRequirements {
  taskProfile: RouteTaskProfile;
  needsTools?: boolean;
  needsJson?: boolean;
  needsEmbeddings?: boolean;
  /** Estimated prompt size; when present, context-window fit is enforced. */
  estimatedPromptTokens?: number;
  requiredOutputTokens?: number;
  /** Explicit local-only mode. Falls back to MODEL_LOCAL_ONLY. */
  localOnly?: boolean;
  /** Explicit model id (`provider:model`). */
  preferredModelId?: string;
  /** False forbids leaving the preferred/profile model. */
  allowFallback?: boolean;
}

export type CandidateReason =
  | "eligible"
  | "not_found"
  | "local_only"
  | "unconfigured"
  | "capability"
  | "circuit_open"
  | "context_window"
  | "fallback_disabled";

export interface CandidateEvaluation {
  id: string;
  providerId: string;
  model: string;
  eligible: boolean;
  reason: CandidateReason;
}

export type RouteReason =
  | "requested"
  | "task_profile"
  | "fallback_list"
  | "provider_default"
  | "catalog_default";

export interface RouteDecision {
  modelId: string;
  providerId: string;
  model: ModelDescriptor;
  reason: RouteReason;
  localOnly: boolean;
  contextWindow: number;
  maxPromptTokens: number;
  requiredOutputTokens: number;
  estimatedPromptTokens: number | null;
  candidates: CandidateEvaluation[];
}

/**
 * Non-throwing view for health/settings surfaces. An unroutable configuration
 * is reported with its candidate reasons instead of failing the health check.
 */
export interface RoutingSnapshot {
  localOnly: boolean;
  modelId: string | null;
  providerId: string | null;
  model: string | null;
  locality: ModelDescriptor["locality"] | null;
  reason: RouteReason | null;
  contextWindow: number | null;
  maxPromptTokens: number | null;
  candidates: CandidateEvaluation[];
  error: string | null;
}

function intFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveLocalOnly(): boolean {
  return process.env.MODEL_LOCAL_ONLY === "true";
}

function safetyTokens(): number {
  const parsed = Number.parseInt(
    process.env.MODEL_CONTEXT_SAFETY_TOKENS ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2_048;
}

function profileModelId(profile: RouteTaskProfile): string | undefined {
  const value =
    process.env[`MODEL_ROUTING_${profile.toUpperCase()}`]?.trim();
  return value || undefined;
}

function fallbackModelIds(): string[] {
  return (process.env.MODEL_FALLBACKS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function dedupe(ids: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    kept.push(id);
  }
  return kept;
}

function capabilityReason(
  descriptor: ModelDescriptor,
  requirements: RouteRequirements,
): CandidateReason | null {
  if (requirements.needsTools && !descriptor.capabilities.tools) {
    return "capability";
  }
  if (requirements.needsJson && !descriptor.capabilities.json) {
    return "capability";
  }
  if (requirements.needsEmbeddings && !descriptor.capabilities.embeddings) {
    return "capability";
  }
  return null;
}

function requiredOutputFor(
  descriptor: ModelDescriptor,
  requirements: RouteRequirements,
): number {
  const requested =
    requirements.requiredOutputTokens ??
    intFromEnv("MODEL_REQUIRED_OUTPUT_TOKENS", descriptor.maxOutputTokens);
  return Math.min(Math.max(0, requested), descriptor.maxOutputTokens);
}

export function maxPromptTokensFor(
  descriptor: ModelDescriptor,
  requiredOutputTokens: number,
): number {
  return Math.max(
    0,
    descriptor.contextWindow - requiredOutputTokens - safetyTokens(),
  );
}

function evaluateCandidate(
  id: string,
  requirements: RouteRequirements,
  localOnly: boolean,
  preferredId: string | undefined,
): CandidateEvaluation {
  const descriptor = getModelDescriptor(id);
  if (!descriptor) {
    return {
      id,
      providerId: id.split(":")[0] ?? "unknown",
      model: id,
      eligible: false,
      reason: "not_found",
    };
  }

  const base = {
    id,
    providerId: descriptor.providerId,
    model: descriptor.model,
  };
  if (localOnly && descriptor.locality !== "local") {
    return { ...base, eligible: false, reason: "local_only" };
  }
  if (!descriptor.configured) {
    return { ...base, eligible: false, reason: "unconfigured" };
  }
  const capability = capabilityReason(descriptor, requirements);
  if (capability) {
    return { ...base, eligible: false, reason: capability };
  }
  if (!isProviderAvailable(descriptor.providerId)) {
    return { ...base, eligible: false, reason: "circuit_open" };
  }
  if (
    preferredId &&
    id !== preferredId &&
    requirements.allowFallback === false
  ) {
    return { ...base, eligible: false, reason: "fallback_disabled" };
  }
  if (requirements.estimatedPromptTokens !== undefined) {
    const max = maxPromptTokensFor(
      descriptor,
      requiredOutputFor(descriptor, requirements),
    );
    if (requirements.estimatedPromptTokens > max) {
      return { ...base, eligible: false, reason: "context_window" };
    }
  }
  return { ...base, eligible: true, reason: "eligible" };
}

function orderedCandidateIds(
  requirements: RouteRequirements,
  preferredId: string | undefined,
): string[] {
  const defaultModel = getDefaultModelDescriptor();
  return dedupe([
    preferredId,
    ...fallbackModelIds(),
    defaultModel.id,
    ...listModelDescriptors().map((descriptor) => descriptor.id),
  ]);
}

/**
 * Pure-ish routing decision (reads configuration, never calls a provider).
 * Deterministic candidate order: explicit request → task profile → fallback
 * list → provider default → catalog.
 */
export function routeModel(
  requirements: RouteRequirements,
): RouteDecision {
  const localOnly = requirements.localOnly ?? resolveLocalOnly();
  const preferredId =
    requirements.preferredModelId ?? profileModelId(requirements.taskProfile);
  const ids = orderedCandidateIds(requirements, preferredId);
  const candidates = ids.map((id) =>
    evaluateCandidate(id, requirements, localOnly, preferredId),
  );
  const selected = candidates.find((candidate) => candidate.eligible);

  if (!selected) {
    throw new NoEligibleModelError(
      candidates.map((candidate) => ({
        id: candidate.id,
        reason: candidate.reason,
      })),
    );
  }

  const descriptor = getModelDescriptor(selected.id);
  if (!descriptor) {
    throw new NoEligibleModelError([{ id: selected.id, reason: "not_found" }]);
  }

  const requiredOutputTokens = requiredOutputFor(descriptor, requirements);
  let reason: RouteReason = "catalog_default";
  if (selected.id === requirements.preferredModelId) {
    reason = "requested";
  } else if (selected.id === preferredId) {
    reason = "task_profile";
  } else if (fallbackModelIds().includes(selected.id)) {
    reason = "fallback_list";
  } else if (selected.id === getDefaultModelDescriptor().id) {
    reason = "provider_default";
  }

  return {
    modelId: selected.id,
    providerId: selected.providerId,
    model: descriptor,
    reason,
    localOnly,
    contextWindow: descriptor.contextWindow,
    maxPromptTokens: maxPromptTokensFor(descriptor, requiredOutputTokens),
    requiredOutputTokens,
    estimatedPromptTokens: requirements.estimatedPromptTokens ?? null,
    candidates,
  };
}

/** Resolve the current route without throwing, for status surfaces. */
export function routingSnapshot(
  requirements: RouteRequirements = { taskProfile: "reasoning" },
): RoutingSnapshot {
  const localOnly = requirements.localOnly ?? resolveLocalOnly();
  try {
    const decision = routeModel(requirements);
    return {
      localOnly: decision.localOnly,
      modelId: decision.modelId,
      providerId: decision.providerId,
      model: decision.model.model,
      locality: decision.model.locality,
      reason: decision.reason,
      contextWindow: decision.contextWindow,
      maxPromptTokens: decision.maxPromptTokens,
      candidates: decision.candidates,
      error: null,
    };
  } catch (error) {
    return {
      localOnly,
      modelId: null,
      providerId: null,
      model: null,
      locality: null,
      reason: null,
      contextWindow: null,
      maxPromptTokens: null,
      candidates:
        error instanceof NoEligibleModelError
          ? error.candidates.map((candidate) => ({
              id: candidate.id,
              providerId: candidate.id.split(":")[0] ?? "unknown",
              model: candidate.id,
              eligible: false,
              reason: candidate.reason as CandidateEvaluation["reason"],
            }))
          : [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Approximate prompt size for window checks; same 4-chars/token rule as D3. */
export function estimateMessagesTokens(
  messages: Array<{ content?: string | null; tool_calls?: unknown[] }>,
): number {
  const chars = messages.reduce((total, message) => {
    const toolCalls = message.tool_calls ?? [];
    return (
      total +
      (message.content?.length ?? 0) +
      (toolCalls.length > 0 ? JSON.stringify(toolCalls).length : 0)
    );
  }, 0);
  return Math.ceil(chars / 4);
}

function retryDelayMs(attempt: number): number {
  const base = intFromEnv("MODEL_RETRY_DELAY_MS", 250);
  return Math.min(base * 2 ** attempt, 5_000);
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RoutedChatResult {
  result: ChatResult;
  decision: RouteDecision;
  attempts: number;
}

/**
 * Routes, dispatches, retries, and falls back. A model is retried only for
 * retryable categories; non-retryable failures stop immediately. Fallback
 * never crosses a local-only boundary because candidates are filtered first.
 */
export async function callRoutedChat(
  requirements: RouteRequirements,
  request: ChatRequest,
): Promise<RoutedChatResult> {
  const estimatedPromptTokens =
    requirements.estimatedPromptTokens ??
    estimateMessagesTokens(request.messages);
  const route = routeModel({ ...requirements, estimatedPromptTokens });
  const eligible = route.candidates.filter((candidate) => candidate.eligible);
  const maxAttemptsPerModel = intFromEnv("MODEL_MAX_ATTEMPTS", 2);
  let attempts = 0;
  let lastCategory: ProviderErrorCategory = "unknown";

  for (const candidate of eligible) {
    const provider = getProviderById(candidate.providerId);
    if (!provider) continue;

    for (let attempt = 0; attempt < maxAttemptsPerModel; attempt++) {
      attempts++;
      try {
        const result = await provider.chat({
          ...request,
          model: candidate.model,
        });
        recordProviderSuccess(candidate.providerId);
        return {
          result,
          decision: {
            ...route,
            modelId: candidate.id,
            providerId: candidate.providerId,
            reason:
              candidate.id === route.modelId ? route.reason : "fallback_list",
          },
          attempts,
        };
      } catch (error) {
        lastCategory = classifyProviderError(error);
        recordProviderFailure(candidate.providerId);
        if (
          !isRetryableCategory(lastCategory) ||
          attempt === maxAttemptsPerModel - 1
        ) {
          break;
        }
        await delay(retryDelayMs(attempt));
      }
    }

    if (requirements.allowFallback === false) break;
  }

  throw new ProviderUnavailableError(
    lastCategory,
    attempts,
    eligible.map((candidate) => candidate.id),
  );
}

export interface RoutedEmbeddingResult {
  embedding: number[];
  decision: RouteDecision;
  attempts: number;
}

/**
 * Embedding dispatch uses the same eligibility, local-only, circuit-breaker,
 * and fallback rules as chat. The provider's own embedding model is used, so
 * the selected candidate contributes provider identity and locality only.
 */
export async function callRoutedEmbeddings(
  requirements: RouteRequirements,
  request: EmbeddingRequest,
): Promise<RoutedEmbeddingResult> {
  const route = routeModel({
    ...requirements,
    needsEmbeddings: true,
  });
  const eligible = route.candidates.filter((candidate) => candidate.eligible);
  const maxAttemptsPerModel = intFromEnv("MODEL_MAX_ATTEMPTS", 2);
  let attempts = 0;
  let lastCategory: ProviderErrorCategory = "unknown";

  for (const candidate of eligible) {
    const provider = getProviderById(candidate.providerId);
    if (!provider) continue;

    for (let attempt = 0; attempt < maxAttemptsPerModel; attempt++) {
      attempts++;
      try {
        const embedding = await provider.embed(request);
        recordProviderSuccess(candidate.providerId);
        return {
          embedding,
          decision: {
            ...route,
            modelId: candidate.id,
            providerId: candidate.providerId,
            reason:
              candidate.id === route.modelId ? route.reason : "fallback_list",
          },
          attempts,
        };
      } catch (error) {
        lastCategory = classifyProviderError(error);
        recordProviderFailure(candidate.providerId);
        if (
          !isRetryableCategory(lastCategory) ||
          attempt === maxAttemptsPerModel - 1
        ) {
          break;
        }
        await delay(retryDelayMs(attempt));
      }
    }

    if (requirements.allowFallback === false) break;
  }

  throw new ProviderUnavailableError(
    lastCategory,
    attempts,
    eligible.map((candidate) => candidate.id),
  );
}
