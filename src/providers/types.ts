import type { LLmMessage } from "@/src/shared/types";

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

export type NormalizedToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ChatUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type ChatRequest = {
  messages: LLmMessage[];
  tools?: readonly ToolDefinition[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
  timeoutMs?: number;
};

export type ChatResult = {
  content: string | null;
  toolCalls: NormalizedToolCall[];
  usage?: ChatUsage;
  model: string;
  provider: string;
};

export type EmbeddingRequest = {
  input: string;
  model?: string;
  dimensions?: number;
  timeoutMs?: number;
};

export type ProviderCapabilities = {
  chat: boolean;
  tools: boolean;
  embeddings: boolean;
};

export interface ModelProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  chat(request: ChatRequest): Promise<ChatResult>;
  embed(request: EmbeddingRequest): Promise<number[]>;
}