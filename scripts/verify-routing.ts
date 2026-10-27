/**
 * D5 model-routing drill. No network or database: it proves the routing
 * decision, local-only fail-closed behavior, fallback order, context ceiling,
 * and cost telemetry from configuration alone.
 *
 *   bun scripts/verify-routing.ts
 */
import {
  estimateUsageCost,
  NoEligibleModelError,
  resolveLocalOnly,
  routeModel,
  routingSnapshot,
} from "@/src/providers";

const ENV_KEYS = [
  "MODEL_PROVIDER",
  "MODEL",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "OPENROUTER_API_KEY",
  "RUNANYWHERE_API_KEY",
  "MODEL_LOCAL_ONLY",
  "MODEL_ROUTING_REASONING",
  "MODEL_FALLBACKS",
  "MODEL_CONTEXT_WINDOW",
  "MODEL_REQUIRED_OUTPUT_TOKENS",
  "MODEL_CONTEXT_SAFETY_TOKENS",
  "MODEL_INPUT_COST_PER_1K_USD",
  "MODEL_OUTPUT_COST_PER_1K_USD",
] as const;

const baseEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

function resetEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.MODEL_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
  process.env.OLLAMA_MODEL = "drill-local";
  process.env.MODEL_LOCAL_ONLY = "false";
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = baseEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function run(): void {
  resetEnv();

  const local = routeModel({ taskProfile: "reasoning" });
  check(local.providerId === "ollama", "default route is the local provider");
  check(local.model.locality === "local", "default provider is local");
  console.log(
    `default route: ${local.modelId} (${local.reason}, ${local.maxPromptTokens} prompt tokens)`,
  );

  process.env.OPENROUTER_API_KEY = "drill-key";
  process.env.MODEL_LOCAL_ONLY = "true";
  const constrained = routeModel({
    taskProfile: "reasoning",
    preferredModelId: "openrouter:remote-model",
  });
  check(constrained.providerId === "ollama", "local-only ignores remote preference");
  check(constrained.localOnly, "local-only is reported on the decision");
  console.log(
    `local-only route: ${constrained.modelId}; remote candidate=${constrained.candidates[0]?.reason}`,
  );

  process.env.OLLAMA_BASE_URL = "https://remote-ollama.example.com";
  const snapshot = routingSnapshot();
  check(snapshot.modelId === null, "remote-only environment fails closed");
  check(snapshot.error !== null, "unroutable state carries an explanation");
  check(
    snapshot.candidates.some((candidate) => candidate.reason === "local_only"),
    "remote candidates are marked local_only",
  );
  console.log(`fail-closed: ${snapshot.error}`);

  resetEnv();
  process.env.MODEL_FALLBACKS = "ollama:drill-local";
  const fallback = routeModel({
    taskProfile: "reasoning",
    preferredModelId: "runanywhere:glm-5.3-flash",
  });
  check(fallback.modelId === "ollama:drill-local", "fallback list is honoured");
  check(fallback.reason === "fallback_list", "fallback reason is explicit");
  console.log(`fallback route: ${fallback.modelId} (${fallback.reason})`);

  resetEnv();
  process.env.MODEL_CONTEXT_WINDOW = "8000";
  process.env.MODEL_REQUIRED_OUTPUT_TOKENS = "4000";
  process.env.MODEL_CONTEXT_SAFETY_TOKENS = "2048";
  let overflow: unknown = null;
  try {
    routeModel({
      taskProfile: "reasoning",
      preferredModelId: "ollama:drill-local",
      allowFallback: false,
      estimatedPromptTokens: 5_000,
    });
  } catch (error) {
    overflow = error;
  }
  check(overflow instanceof NoEligibleModelError, "overflow is rejected pre-dispatch");
  console.log("context overflow: rejected before dispatch");

  process.env.MODEL_INPUT_COST_PER_1K_USD = "0.5";
  process.env.MODEL_OUTPUT_COST_PER_1K_USD = "1.5";
  const cost = estimateUsageCost({ promptTokens: 2_000, completionTokens: 1_000 });
  check(cost.totalCostUsd === 2.5, "configured cost estimate is applied");
  check(cost.configured, "cost source is reported");
  console.log(`cost telemetry: $${cost.totalCostUsd.toFixed(4)} (flat rate)`);

  check(resolveLocalOnly() === false, "local-only flag is restored");
}

try {
  run();
  console.log("D5 routing drill: PASS");
} catch (error) {
  console.error(
    `D5 routing drill: FAIL — ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  restoreEnv();
}
