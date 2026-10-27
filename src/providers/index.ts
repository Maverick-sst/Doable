import type { LLmMessage } from "@/src/shared/types";
import {
  getDefaultModelDescriptor,
  listModelDescriptors,
} from "./catalog";
import { NoEligibleModelError } from "./errors";
import { PROVIDERS } from "./registry";
import type { ProviderId } from "./registry";
import { callRoutedChat, callRoutedEmbeddings, resolveLocalOnly } from "./router";
import type {
  ChatRequest,
  ChatResult,
  EmbeddingRequest,
  ModelProvider,
  NormalizedToolCall,
  ProviderCapabilities,
  ToolDefinition,
} from "./types";

export type {
  ChatRequest,
  ChatResult,
  EmbeddingRequest,
  ModelProvider,
  NormalizedToolCall,
  ProviderCapabilities,
  ToolDefinition,
};

export type { ProviderId } from "./registry";
export { getProviderById, getDefaultProviderId, PROVIDERS } from "./registry";

/**
 * Provider selection is explicit. `MODEL_PROVIDER` wins; otherwise infer from
 * configured credentials, preferring a local endpoint over a remote one.
 * Under `MODEL_LOCAL_ONLY`, a remote default is replaced by a local provider
 * and an environment with no local endpoint fails closed.
 */
function selectDefaultProviderId(): ProviderId {
  const preferred = getDefaultModelDescriptor();
  if (!resolveLocalOnly() || preferred.locality === "local") {
    return preferred.providerId;
  }
  const local = listModelDescriptors().find(
    (descriptor) => descriptor.locality === "local" && descriptor.configured,
  );
  if (local) return local.providerId;
  throw new NoEligibleModelError(
    listModelDescriptors().map((descriptor) => ({
      id: descriptor.id,
      reason: descriptor.locality === "local" ? "unconfigured" : "local_only",
    })),
  );
}

export function getProvider(): ModelProvider {
  return PROVIDERS[selectDefaultProviderId()];
}

export function getProviderId(): string {
  return getProvider().id;
}

export function getProviderCapabilities(): ProviderCapabilities {
  return getProvider().capabilities;
}

/**
 * Capability probe for optional features (embeddings). Unlike
 * `getProviderCapabilities`, an unroutable environment is `null` rather than a
 * thrown error, so callers can degrade instead of failing a write.
 */
/** Stable identity for the selected provider's embedding model. */
export function getEmbeddingIdentity(): {
  providerId: string;
  modelId: string;
} | null {
  const provider = getProvider();
  if (!provider.embeddingModelId) return null;
  return { providerId: provider.id, modelId: provider.embeddingModelId };
}

export function getProviderCapabilitiesOrNull(): ProviderCapabilities | null {
  try {
    return getProviderCapabilities();
  } catch {
    return null;
  }
}

export async function callChat(input: {
  messages: LLmMessage[];
  tools?: readonly ToolDefinition[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
  timeoutMs?: number;
}): Promise<ChatResult> {
  const request: ChatRequest = {
    messages: input.messages,
    tools: input.tools,
    model: input.model,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    responseFormat: input.responseFormat,
    timeoutMs: input.timeoutMs,
  };
  const { result } = await callRoutedChat(
    {
      taskProfile: "reasoning",
      needsTools: (input.tools?.length ?? 0) > 0,
      needsJson: input.responseFormat === "json",
      preferredModelId: input.model?.includes(":") ? input.model : undefined,
    },
    request,
  );
  return result;
}

export async function callEmbeddings(input: {
  input: string;
  model?: string;
  dimensions?: number;
  timeoutMs?: number;
}): Promise<number[]> {
  const request: EmbeddingRequest = input;
  const { embedding } = await callRoutedEmbeddings(
    { taskProfile: "reasoning" },
    request,
  );
  return embedding;
}
export {
  buildModelDescriptor,
  getDefaultModelDescriptor,
  getModelDescriptor,
  listModelDescriptors,
} from "./catalog";
export type {
  ModelCapabilities,
  ModelDescriptor,
  ModelLocality,
} from "./catalog";
export {
  callRoutedChat,
  callRoutedEmbeddings,
  estimateMessagesTokens,
  maxPromptTokensFor,
  resolveLocalOnly,
  routeModel,
  routingSnapshot,
} from "./router";
export type {
  CandidateEvaluation,
  CandidateReason,
  RouteDecision,
  RouteReason,
  RouteRequirements,
  RouteTaskProfile,
  RoutedChatResult,
  RoutedEmbeddingResult,
  RoutingSnapshot,
} from "./router";
export { estimateUsageCost } from "./cost";
export type { UsageCost } from "./cost";
export {
  isProviderAvailable,
  providerHealthSnapshot,
  recordProviderFailure,
  recordProviderSuccess,
  resetProviderHealth,
} from "./health";
export {
  classifyProviderError,
  ContextWindowExceededError,
  isRetryableCategory,
  NoEligibleModelError,
  ProviderUnavailableError,
} from "./errors";
export type { ProviderErrorCategory } from "./errors";
