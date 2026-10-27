import type {
  ChatRequest,
  ChatResult,
  EmbeddingRequest,
  ModelProvider,
  NormalizedToolCall,
} from "./types";

const DEFAULT_CHAT_TIMEOUT_MS = 180_000;
const DEFAULT_EMBEDDING_TIMEOUT_MS = 60_000;
const DEFAULT_CHAT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_EMBEDDING_MODEL = "nvidia/llama-nemotron-embed-vl-1b-v2:free";

type OpenRouterToolCall = {
  id: string;
  function: { name: string; arguments: string };
};

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenRouterToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string };
};

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not configured. Choose a local provider or set the key.",
    );
  }
  return key;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey()}`,
    "HTTP-Referer":
      process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000",
    "X-Title": "Doable",
    "Content-Type": "application/json",
  };
}

async function readJson(response: Response): Promise<OpenRouterResponse> {
  let data: OpenRouterResponse;
  try {
    data = (await response.json()) as OpenRouterResponse;
  } catch {
    throw new Error(`Provider returned a non-JSON response (${response.status})`);
  }
  if (!response.ok || data.error) {
    const detail = data.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`Provider request failed: ${detail}`);
  }
  return data;
}

export const openRouterProvider: ModelProvider = {
  id: "openrouter",
  capabilities: { chat: true, tools: true, embeddings: true },
  get embeddingModelId() {
    return process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  },

  async chat(request: ChatRequest): Promise<ChatResult> {
    const model = request.model ?? process.env.MODEL ?? DEFAULT_CHAT_MODEL;
    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
      body.tool_choice = "auto";
    }
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.responseFormat === "json") {
      body.response_format = { type: "json_object" };
    }

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(
          request.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS,
        ),
      },
    );

    const data = await readJson(response);
    const message = data.choices?.[0]?.message;
    const toolCalls: NormalizedToolCall[] = (message?.tool_calls ?? []).map(
      (call) => ({
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      }),
    );

    return {
      content: message?.content ?? null,
      toolCalls,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
            cachedPromptTokens:
              data.usage.prompt_tokens_details?.cached_tokens,
          }
        : undefined,
      model,
      provider: "openrouter",
    };
  },

  async embed(request: EmbeddingRequest): Promise<number[]> {
    const model =
      request.model ??
      process.env.EMBEDDING_MODEL ??
      DEFAULT_EMBEDDING_MODEL;

    const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model,
        input: request.input,
        ...(request.dimensions ? { dimensions: request.dimensions } : {}),
      }),
      signal: AbortSignal.timeout(
        request.timeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS,
      ),
    });

    const data = await readJson(response);
    const embedding = (
      data as unknown as { data?: Array<{ embedding?: number[] }> }
    ).data?.[0]?.embedding;
    if (!embedding) throw new Error("Provider returned no embedding");
    return embedding;
  },
};