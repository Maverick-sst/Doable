import { beforeEach, describe, expect, test } from "bun:test";
import {
  callRoutedChat,
  classifyProviderError,
  estimateMessagesTokens,
  estimateUsageCost,
  isProviderAvailable,
  isRetryableCategory,
  NoEligibleModelError,
  PROVIDERS,
  recordProviderFailure,
  resetProviderHealth,
  resolveLocalOnly,
  routeModel,
  routingSnapshot,
} from "@/src/providers";
import {
  resolveRunTokenBudget,
  sumUsageTokens,
} from "@/src/runtime/model-budget";

// Model routing, capability filtering, local-only enforcement, circuit
// breaking, and usage accounting. No network calls: routeModel is pure
// configuration evaluation.

const ENV_KEYS = [
  "MODEL",
  "MODEL_PROVIDER",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "OLLAMA_CONTEXT_WINDOW",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "OPENROUTER_CONTEXT_WINDOW",
  "RUNANYWHERE_API_KEY",
  "RUNANYWHERE_MODEL",
  "RUNANYWHERE_CONTEXT_WINDOW",
  "MODEL_CONTEXT_WINDOW",
  "MODEL_MAX_OUTPUT_TOKENS",
  "MODEL_REQUIRED_OUTPUT_TOKENS",
  "MODEL_CONTEXT_SAFETY_TOKENS",
  "MODEL_LOCAL_ONLY",
  "MODEL_ROUTING_REASONING",
  "MODEL_ROUTING_PLANNING",
  "MODEL_ROUTING_IMPLEMENTATION",
  "MODEL_FALLBACKS",
  "MODEL_CIRCUIT_FAILURES",
  "MODEL_CIRCUIT_COOLDOWN_MS",
  "MODEL_MAX_ATTEMPTS",
  "MODEL_RETRY_DELAY_MS",
  "MODEL_INPUT_COST_PER_1K_USD",
  "MODEL_OUTPUT_COST_PER_1K_USD",
  "RUN_TOKEN_BUDGET",
];

type EnvSnapshot = Map<string, string | undefined>;

function snapshotEnv(): EnvSnapshot {
  return new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of ENV_KEYS) {
    const value = snapshot.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetProviderHealth();
}

function baseEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.MODEL_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
  process.env.OLLAMA_MODEL = "local-test";
  process.env.MODEL_LOCAL_ONLY = "false";
}

let snapshot: EnvSnapshot;

beforeEach(() => {
  snapshot = snapshotEnv();
  baseEnv();
});

function withEnvRestored(run: () => void): void {
  try {
    run();
  } finally {
    restoreEnv(snapshot);
  }
}

async function withEnvRestoredAsync(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } finally {
    restoreEnv(snapshot);
  }
}

describe("Default routing", () => {
  test("picks the configured local provider and declares its window", () => {
    withEnvRestored(() => {
      const decision = routeModel({ taskProfile: "reasoning" });
      expect(decision.providerId).toBe("ollama");
      expect(decision.modelId).toBe("ollama:local-test");
      expect(decision.model.locality).toBe("local");
      expect(decision.contextWindow).toBe(32_768);
      expect(decision.maxPromptTokens).toBeLessThan(decision.contextWindow);
      expect(decision.reason).toBe("provider_default");
      expect(decision.localOnly).toBe(false);
    });
  });

  test("task-profile routing selects the configured model", () => {
    withEnvRestored(() => {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.MODEL_ROUTING_REASONING = "openrouter:reasoner";
      const decision = routeModel({ taskProfile: "reasoning" });
      expect(decision.modelId).toBe("openrouter:reasoner");
      expect(decision.model.locality).toBe("remote");
      expect(decision.reason).toBe("task_profile");
    });
  });
});

describe("Local-only enforcement", () => {
  test("remote candidates are rejected and a local model is used", () => {
    withEnvRestored(() => {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.MODEL_LOCAL_ONLY = "true";
      const decision = routeModel({
        taskProfile: "reasoning",
        preferredModelId: "openrouter:gpt-4o",
      });
      expect(decision.localOnly).toBe(true);
      expect(decision.model.locality).toBe("local");
      const rejected = decision.candidates.find(
        (candidate) => candidate.id === "openrouter:gpt-4o",
      );
      expect(rejected?.reason).toBe("local_only");
    });
  });

  test("fails instead of silently falling back to remote", () => {
    withEnvRestored(() => {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.MODEL_LOCAL_ONLY = "true";
      let caught: unknown = null;
      try {
        routeModel({
          taskProfile: "reasoning",
          preferredModelId: "openrouter:gpt-4o",
          allowFallback: false,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught instanceof NoEligibleModelError).toBe(true);
      expect(
        (caught as NoEligibleModelError).candidates.some(
          (candidate) =>
            candidate.id === "openrouter:gpt-4o" &&
            candidate.reason === "local_only",
        ),
      ).toBe(true);
      expect(String((caught as Error).message)).not.toContain("test-key");
    });
  });

  test("resolveLocalOnly reads the env flag", () => {
    withEnvRestored(() => {
      process.env.MODEL_LOCAL_ONLY = "true";
      expect(resolveLocalOnly()).toBe(true);
      process.env.MODEL_LOCAL_ONLY = "false";
      expect(resolveLocalOnly()).toBe(false);
    });
  });
});

describe("Capability and configuration filters", () => {
  test("embedding requirement excludes providers without embeddings", () => {
    withEnvRestored(() => {
      process.env.RUNANYWHERE_API_KEY = "test-key";
      const decision = routeModel({
        taskProfile: "implementation",
        needsEmbeddings: true,
        preferredModelId: "runanywhere:glm",
      });
      expect(decision.modelId).not.toBe("runanywhere:glm");
      expect(
        decision.candidates.find(
          (candidate) => candidate.id === "runanywhere:glm",
        )?.reason,
      ).toBe("capability");
    });
  });

  test("missing credentials make a remote model ineligible", () => {
    withEnvRestored(() => {
      let caught: unknown = null;
      try {
        routeModel({
          taskProfile: "reasoning",
          preferredModelId: "openrouter:gpt-4o",
          allowFallback: false,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught instanceof NoEligibleModelError).toBe(true);
      expect(
        (caught as NoEligibleModelError).candidates[0]?.reason,
      ).toBe("unconfigured");
    });
  });

  test("context-window overflow is rejected before dispatch", () => {
    withEnvRestored(() => {
      process.env.MODEL_CONTEXT_WINDOW = "8000";
      process.env.MODEL_REQUIRED_OUTPUT_TOKENS = "4000";
      process.env.MODEL_CONTEXT_SAFETY_TOKENS = "2048";
      let caught: unknown = null;
      try {
        routeModel({
          taskProfile: "reasoning",
          preferredModelId: "ollama:local-test",
          allowFallback: false,
          estimatedPromptTokens: 5_000,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught instanceof NoEligibleModelError).toBe(true);
      expect(
        (caught as NoEligibleModelError).candidates[0]?.reason,
      ).toBe("context_window");
    });
  });

  test("fallback list is honoured when the preferred model is unavailable", () => {
    withEnvRestored(() => {
      process.env.MODEL_FALLBACKS = "ollama:fallback-model";
      const decision = routeModel({
        taskProfile: "reasoning",
        preferredModelId: "openrouter:missing",
      });
      expect(decision.modelId).toBe("ollama:fallback-model");
      expect(decision.reason).toBe("fallback_list");
    });
  });
});

describe("Circuit breaker", () => {
  test("opens after repeated failures and half-opens after cooldown", () => {
    withEnvRestored(() => {
      process.env.MODEL_CIRCUIT_FAILURES = "1";
      process.env.MODEL_CIRCUIT_COOLDOWN_MS = "1000";
      const start = 1_000_000;
      expect(isProviderAvailable("ollama", start)).toBe(true);
      recordProviderFailure("ollama", start);
      expect(isProviderAvailable("ollama", start + 500)).toBe(false);
      expect(isProviderAvailable("ollama", start + 1001)).toBe(true);

      let caught: unknown = null;
      try {
        routeModel({
          taskProfile: "reasoning",
          preferredModelId: "ollama:local-test",
          allowFallback: false,
        });
      } catch (error) {
        caught = error;
      }
      // The route uses real time, so the breaker is closed again by now.
      expect(caught).toBeNull();
    });
  });
});

describe("Dispatch and egress", () => {
  test("local-only never calls a remote provider", async () => {
    await withEnvRestoredAsync(async () => {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.MODEL_LOCAL_ONLY = "true";
      const originalOllama = PROVIDERS.ollama.chat;
      const originalOpenRouter = PROVIDERS.openrouter.chat;
      let remoteCalls = 0;
      try {
        PROVIDERS.openrouter.chat = async () => {
          remoteCalls += 1;
          throw new Error("remote must not be called");
        };
        PROVIDERS.ollama.chat = async (request) => ({
          content: "local answer",
          toolCalls: [],
          model: request.model ?? "local-test",
          provider: "ollama",
        });
        const { result, decision } = await callRoutedChat(
          {
            taskProfile: "reasoning",
            preferredModelId: "openrouter:gpt-4o",
            localOnly: true,
          },
          { messages: [{ role: "user", content: "hi" }] },
        );
        expect(decision.providerId).toBe("ollama");
        expect(remoteCalls).toBe(0);
        expect(result.content).toBe("local answer");
      } finally {
        PROVIDERS.ollama.chat = originalOllama;
        PROVIDERS.openrouter.chat = originalOpenRouter;
      }
    });
  });

  test("a retryable failure falls back to the next eligible model", async () => {
    await withEnvRestoredAsync(async () => {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.MODEL_MAX_ATTEMPTS = "1";
      process.env.MODEL_FALLBACKS = "ollama:local-test";
      const originalOllama = PROVIDERS.ollama.chat;
      const originalOpenRouter = PROVIDERS.openrouter.chat;
      let openRouterCalls = 0;
      try {
        PROVIDERS.openrouter.chat = async () => {
          openRouterCalls += 1;
          throw new Error("HTTP 503 server error");
        };
        PROVIDERS.ollama.chat = async (request) => ({
          content: "fallback answer",
          toolCalls: [],
          model: request.model ?? "local-test",
          provider: "ollama",
        });
        const { result, decision, attempts } = await callRoutedChat(
          {
            taskProfile: "reasoning",
            preferredModelId: "openrouter:gpt-4o",
            allowFallback: true,
          },
          { messages: [{ role: "user", content: "hi" }] },
        );
        expect(openRouterCalls).toBe(1);
        expect(decision.providerId).toBe("ollama");
        expect(decision.reason).toBe("fallback_list");
        expect(attempts).toBe(2);
        expect(result.content).toBe("fallback answer");
      } finally {
        PROVIDERS.ollama.chat = originalOllama;
        PROVIDERS.openrouter.chat = originalOpenRouter;
      }
    });
  });

  test("status snapshot reports an unroutable local-only environment", () => {
    withEnvRestored(() => {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.MODEL_LOCAL_ONLY = "true";
      process.env.OLLAMA_BASE_URL = "https://remote-ollama.example.com";
      const snapshot = routingSnapshot();
      expect(snapshot.localOnly).toBe(true);
      expect(snapshot.modelId).toBeNull();
      expect(snapshot.error).not.toBeNull();
      expect(
        snapshot.candidates.some(
          (candidate) =>
            candidate.id === "openrouter:openai/gpt-4o-mini" &&
            candidate.reason === "local_only",
        ),
      ).toBe(true);
    });
  });
});

describe("Error taxonomy", () => {
  test("classifies provider failures and retryability", () => {
    expect(classifyProviderError(new Error("429 rate limit"))).toBe(
      "rate_limit",
    );
    expect(classifyProviderError(new Error("fetch failed: ECONNREFUSED"))).toBe(
      "transport",
    );
    expect(classifyProviderError(new Error("API key is not configured"))).toBe(
      "auth",
    );
    expect(classifyProviderError(new Error("HTTP 503"))).toBe("server");
    expect(classifyProviderError(new Error("HTTP 400 invalid request"))).toBe(
      "invalid_request",
    );
    expect(isRetryableCategory("rate_limit")).toBe(true);
    expect(isRetryableCategory("timeout")).toBe(true);
    expect(isRetryableCategory("auth")).toBe(false);
    expect(isRetryableCategory("invalid_request")).toBe(false);
  });

  test("providers are registered exactly once", () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual([
      "ollama",
      "openrouter",
      "runanywhere",
    ]);
  });
});

describe("Usage accounting", () => {
  test("sums provider-reported totals and ignores malformed payloads", () => {
    expect(
      sumUsageTokens([
        { totalTokens: 100 },
        { totalTokens: 25 },
        { totalTokens: null },
        "nope",
      ]),
    ).toBe(125);
  });

  test("the run token budget is disabled unless configured", () => {
    withEnvRestored(() => {
      delete process.env.RUN_TOKEN_BUDGET;
      expect(resolveRunTokenBudget()).toBe(0);
      process.env.RUN_TOKEN_BUDGET = "500000";
      expect(resolveRunTokenBudget()).toBe(500_000);
    });
  });

  test("token estimation uses the same 4-chars/token rule", () => {
    expect(
      estimateMessagesTokens([
        { content: "x".repeat(400) },
        { content: "y".repeat(40) },
      ]),
    ).toBe(110);
  });

  test("cost telemetry is opt-in and honest about its source", () => {
    withEnvRestored(() => {
      delete process.env.MODEL_INPUT_COST_PER_1K_USD;
      delete process.env.MODEL_OUTPUT_COST_PER_1K_USD;
      const unconfigured = estimateUsageCost({
        promptTokens: 1_000,
        completionTokens: 500,
      });
      expect(unconfigured.totalCostUsd).toBe(0);
      expect(unconfigured.configured).toBe(false);

      process.env.MODEL_INPUT_COST_PER_1K_USD = "1";
      process.env.MODEL_OUTPUT_COST_PER_1K_USD = "2";
      const configured = estimateUsageCost({
        promptTokens: 1_000,
        completionTokens: 500,
      });
      expect(configured.inputCostUsd).toBe(1);
      expect(configured.outputCostUsd).toBe(1);
      expect(configured.totalCostUsd).toBe(2);
      expect(configured.configured).toBe(true);
    });
  });
});
