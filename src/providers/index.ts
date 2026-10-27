import type { LLmMessage } from "@/src/shared/types";
import { ollamaProvider } from "./ollama";
import { openRouterProvider } from "./openrouter";
import { runAnywhereProvider } from "./runanywhere";
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

export type ProviderId = "ollama" | "openrouter" | "runanywhere";

/**
 * Provider selection is explicit. `MODEL_PROVIDER` wins; otherwise infer from
 * configured credentials, preferring a local endpoint over a remote one.
 */
export function getProvider(): ModelProvider {
  const explicit = process.env.MODEL_PROVIDER;

  if (explicit === "runanywhere") return runAnywhereProvider;
  if (explicit === "openrouter") return openRouterProvider;
  if (explicit === "ollama" || explicit === "local") return ollamaProvider;

  if (process.env.OLLAMA_BASE_URL) return ollamaProvider;
  if (process.env.RUNANYWHERE_API_KEY) return runAnywhereProvider;
  if (process.env.OPENROUTER_API_KEY) return openRouterProvider;
  return ollamaProvider;
}

export function getProviderId(): string {
  return getProvider().id;
}

export function getProviderCapabilities(): ProviderCapabilities {
  return getProvider().capabilities;
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
  return getProvider().chat(request);
}

export async function callEmbeddings(input: {
  input: string;
  model?: string;
  dimensions?: number;
  timeoutMs?: number;
}): Promise<number[]> {
  const provider = getProvider();
  if (!provider.capabilities.embeddings) {
    throw new Error(
      `Provider ${provider.id} does not support embeddings`,
    );
  }
  const request: EmbeddingRequest = input;
  return provider.embed(request);
}