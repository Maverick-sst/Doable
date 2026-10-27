import type {
  ChatRequest,
  ChatResult,
  EmbeddingRequest,
  ModelProvider,
  NormalizedToolCall,
} from "./types";

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_CHAT_TIMEOUT_MS = 180_000;
const DEFAULT_EMBEDDING_TIMEOUT_MS = 60_000;

type OllamaToolCall = {
  function?: { name?: string; arguments?: unknown };
};

type OllamaChatResponse = {
  message?: {
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
};

function baseUrl(): string {
  return (process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function chatModel(): string {
  return (
    process.env.OLLAMA_MODEL ??
    process.env.MODEL ??
    "llama3.2"
  );
}

function embeddingModel(): string {
  return process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text";
}

async function readJson<T>(response: Response): Promise<T> {
  let data: T & { error?: string };
  try {
    data = (await response.json()) as T & { error?: string };
  } catch {
    throw new Error(`Local model returned a non-JSON response (${response.status})`);
  }
  if (!response.ok || data.error) {
    throw new Error(
      `Local model request failed: ${data.error ?? `HTTP ${response.status}`}`,
    );
  }
  return data;
}

function normalizeToolCalls(calls: OllamaToolCall[] | undefined): NormalizedToolCall[] {
  return (calls ?? []).flatMap((call, index) => {
    const name = call.function?.name;
    if (!name) return [];
    const args = call.function?.arguments;
    return [
      {
        id: `local-call-${index}-${name}`,
        name,
        arguments:
          typeof args === "string" ? args : JSON.stringify(args ?? {}),
      },
    ];
  });
}

export const ollamaProvider: ModelProvider = {
  id: "ollama",
  capabilities: { chat: true, tools: true, embeddings: true },
  get embeddingModelId() {
    return embeddingModel();
  },

  async chat(request: ChatRequest): Promise<ChatResult> {
    const model = request.model ?? chatModel();
    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      stream: false,
      options: {
        ...(request.temperature !== undefined
          ? { temperature: request.temperature }
          : {}),
        ...(request.maxTokens !== undefined
          ? { num_predict: request.maxTokens }
          : {}),
      },
    };
    if (request.tools && request.tools.length > 0) body.tools = request.tools;
    if (request.responseFormat === "json") body.format = "json";

    const response = await fetch(`${baseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(
        request.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS,
      ),
    });

    const data = await readJson<OllamaChatResponse>(response);
    const promptTokens = data.prompt_eval_count;
    const completionTokens = data.eval_count;

    return {
      content: data.message?.content ?? null,
      toolCalls: normalizeToolCalls(data.message?.tool_calls),
      usage:
        promptTokens !== undefined || completionTokens !== undefined
          ? {
              promptTokens,
              completionTokens,
              totalTokens:
                (promptTokens ?? 0) + (completionTokens ?? 0),
            }
          : undefined,
      model,
      provider: "ollama",
    };
  },

  async embed(request: EmbeddingRequest): Promise<number[]> {
    const model = request.model ?? embeddingModel();
    const response = await fetch(`${baseUrl()}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: request.input }),
      signal: AbortSignal.timeout(
        request.timeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS,
      ),
    });

    if (response.ok) {
      const data = await readJson<{ embeddings?: number[][] }>(response);
      const embedding = data.embeddings?.[0];
      if (embedding) return embedding;
    }

    // Older Ollama releases expose /api/embeddings with a single prompt.
    const fallback = await fetch(`${baseUrl()}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: request.input }),
      signal: AbortSignal.timeout(
        request.timeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS,
      ),
    });
    const data = await readJson<{ embedding?: number[] }>(fallback);
    if (!data.embedding) throw new Error("Local model returned no embedding");
    return data.embedding;
  },
};