import type { ProviderId } from "./registry";
import { getDefaultProviderId } from "./registry";

export type ModelLocality = "local" | "remote";

export interface ModelCapabilities {
  chat: boolean;
  tools: boolean;
  json: boolean;
  embeddings: boolean;
}

/**
 * Declared model capabilities. Providers do not advertise context windows or
 * JSON support, so these are configuration with conservative defaults and
 * explicit env overrides. A wrong window is a routing input error, not a
 * provider error — keep it visible here.
 */
export interface ModelDescriptor {
  id: string;
  providerId: ProviderId;
  model: string;
  locality: ModelLocality;
  capabilities: ModelCapabilities;
  contextWindow: number;
  maxOutputTokens: number;
  /** False when a remote provider is missing its credential. */
  configured: boolean;
}

const DEFAULT_CONTEXT_WINDOWS: Record<ProviderId, number> = {
  ollama: 32_768,
  openrouter: 128_000,
  runanywhere: 128_000,
};

const DEFAULT_OUTPUT_TOKENS = 8_192;

function intFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isLocalUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1"
    );
  } catch {
    return false;
  }
}

function modelFor(providerId: ProviderId): string {
  if (providerId === "ollama") {
    return process.env.OLLAMA_MODEL ?? process.env.MODEL ?? "llama3.2";
  }
  if (providerId === "openrouter") {
    return (
      process.env.OPENROUTER_MODEL ??
      process.env.MODEL ??
      "openai/gpt-4o-mini"
    );
  }
  return process.env.MODEL ?? "glm-5.3-flash";
}

function contextWindowFor(providerId: ProviderId): number {
  const specific = {
    ollama: "OLLAMA_CONTEXT_WINDOW",
    openrouter: "OPENROUTER_CONTEXT_WINDOW",
    runanywhere: "RUNANYWHERE_CONTEXT_WINDOW",
  }[providerId];
  const fallback = DEFAULT_CONTEXT_WINDOWS[providerId];
  return intFromEnv(
    specific,
    intFromEnv("MODEL_CONTEXT_WINDOW", fallback),
  );
}

function configured(providerId: ProviderId): boolean {
  if (providerId === "ollama") return true;
  if (providerId === "openrouter") {
    return Boolean(process.env.OPENROUTER_API_KEY);
  }
  return Boolean(process.env.RUNANYWHERE_API_KEY);
}

function localityFor(providerId: ProviderId): ModelLocality {
  if (providerId === "ollama") {
    return isLocalUrl(process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434")
      ? "local"
      : "remote";
  }
  return "remote";
}

export function buildModelDescriptor(
  providerId: ProviderId,
  model: string,
): ModelDescriptor {
  const contextWindow = contextWindowFor(providerId);
  const maxOutputTokens = Math.min(
    intFromEnv("MODEL_MAX_OUTPUT_TOKENS", DEFAULT_OUTPUT_TOKENS),
    Math.max(512, Math.floor(contextWindow / 2)),
  );

  return {
    id: `${providerId}:${model}`,
    providerId,
    model,
    locality: localityFor(providerId),
    capabilities: {
      chat: true,
      tools: true,
      json: true,
      embeddings: providerId !== "runanywhere",
    },
    contextWindow,
    maxOutputTokens,
    configured: configured(providerId),
  };
}

/** One descriptor per provider, using the currently configured model. */
export function listModelDescriptors(): ModelDescriptor[] {
  const providerIds: ProviderId[] = ["ollama", "openrouter", "runanywhere"];
  return providerIds.map((providerId) =>
    buildModelDescriptor(providerId, modelFor(providerId)),
  );
}

/** Accepts `provider:model`; unknown ids are synthesized from provider defaults. */
export function getModelDescriptor(id: string): ModelDescriptor | null {
  const separator = id.indexOf(":");
  if (separator <= 0 || separator === id.length - 1) return null;
  const providerId = id.slice(0, separator) as ProviderId;
  if (!["ollama", "openrouter", "runanywhere"].includes(providerId)) {
    return null;
  }
  return buildModelDescriptor(providerId, id.slice(separator + 1));
}

export function getDefaultModelDescriptor(): ModelDescriptor {
  const providerId = getDefaultProviderId();
  return buildModelDescriptor(providerId, modelFor(providerId));
}
