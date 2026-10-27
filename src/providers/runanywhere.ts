import type {
  ChatRequest,
  ChatResult,
  ModelProvider,
  NormalizedToolCall,
} from "./types";

const DEFAULT_BASE_URL = "https://inference.runanywhere.ai/v1";
const DEFAULT_MODEL = "glm-5.3-flash";
const DEFAULT_CHAT_TIMEOUT_MS = 180_000;

type RunAnywhereToolCall = {
  id?: string;
  function?: { name?: string; arguments?: string };
};

type RunAnywhereResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: RunAnywhereToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string; code?: string };
};

function baseUrl(): string {
  return (process.env.RUNANYWHERE_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

function apiKey(): string {
  const key = process.env.RUNANYWHERE_API_KEY;
  if (!key) {
    throw new Error(
      "RUNANYWHERE_API_KEY is not configured. Set it or choose another provider.",
    );
  }
  return key;
}

async function readJson(response: Response): Promise<RunAnywhereResponse> {
  let data: RunAnywhereResponse;
  try {
    data = (await response.json()) as RunAnywhereResponse;
  } catch {
    throw new Error(
      `RunAnywhere returned a non-JSON response (${response.status})`,
    );
  }
  if (!response.ok || data.error) {
    const detail = data.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`RunAnywhere request failed: ${detail}`);
  }
  return data;
}

function normalizeToolCalls(
  calls: RunAnywhereToolCall[] | undefined,
): NormalizedToolCall[] {
  return (calls ?? []).flatMap((call, index) => {
    const name = call.function?.name;
    if (!name) return [];
    return [
      {
        id: call.id ?? `runanywhere-call-${index}-${name}`,
        name,
        arguments: call.function?.arguments ?? "{}",
      },
    ];
  });
}

/**
 * RunAnywhere is an OpenAI-compatible inference gateway.
 *
 * It currently exposes chat completions only; `/embeddings` returns 404. The
 * provider advertises that through `capabilities.embeddings` so semantic
 * retrieval degrades instead of failing a node.
 */
export const runAnywhereProvider: ModelProvider = {
  id: "runanywhere",
  capabilities: { chat: true, tools: true, embeddings: false },
  embeddingModelId: null,

  async chat(request: ChatRequest): Promise<ChatResult> {
    const model = request.model ?? process.env.MODEL ?? DEFAULT_MODEL;
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

    const response = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(
        request.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS,
      ),
    });

    const data = await readJson(response);
    const choice = data.choices?.[0];
    const message = choice?.message;

    return {
      content: message?.content ?? null,
      toolCalls: normalizeToolCalls(message?.tool_calls),
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
            cachedPromptTokens:
              data.usage.prompt_tokens_details?.cached_tokens,
          }
        : undefined,
      model: data.model ?? model,
      provider: "runanywhere",
    };
  },

  async embed(): Promise<number[]> {
    throw new Error(
      "RunAnywhere does not provide embeddings. Semantic file search is disabled for this provider.",
    );
  },
};