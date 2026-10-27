import type { ModelProvider } from "./types";
import { ollamaProvider } from "./ollama";
import { openRouterProvider } from "./openrouter";
import { runAnywhereProvider } from "./runanywhere";

export type ProviderId = "ollama" | "openrouter" | "runanywhere";

export const PROVIDERS: Record<ProviderId, ModelProvider> = {
  ollama: ollamaProvider,
  openrouter: openRouterProvider,
  runanywhere: runAnywhereProvider,
};

export function getProviderById(id: string): ModelProvider | null {
  return PROVIDERS[id as ProviderId] ?? null;
}

/** Explicit MODEL_PROVIDER wins; otherwise infer from configured credentials. */
export function getDefaultProviderId(): ProviderId {
  const explicit = process.env.MODEL_PROVIDER;

  if (explicit === "runanywhere") return "runanywhere";
  if (explicit === "openrouter") return "openrouter";
  if (explicit === "ollama" || explicit === "local") return "ollama";

  if (process.env.OLLAMA_BASE_URL) return "ollama";
  if (process.env.RUNANYWHERE_API_KEY) return "runanywhere";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  return "ollama";
}
