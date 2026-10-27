import {
  buildCacheKey,
  contentDigest,
  runtimeCache,
} from "@/src/runtime/cache";
import type { CacheOutcome } from "@/src/runtime/cache";
import { callEmbeddings, getEmbeddingIdentity } from "@/src/providers";

const DEFAULT_CACHE_TTL_DAYS = 30;

function cacheTtlSeconds(): number {
  const parsed = Number.parseInt(
    process.env.CACHE_EMBEDDING_TTL_DAYS ?? "",
    10,
  );
  const days =
    Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CACHE_TTL_DAYS;
  return days * 24 * 60 * 60;
}

function isEmbedding(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

export interface EmbeddingResult {
  embedding: number[];
  outcome: CacheOutcome;
  keyDigest: string;
}

/**
 * Embedding seam with a content-addressed cache. The key includes the project,
 * provider, and embedding model, so project deletion, a provider switch, or a
 * model change cannot reuse a stale vector. Cache failure falls through to the
 * provider call.
 */
export async function getEmbeddingsWithCache(
  text: string,
  options: { projectId?: string | null } = {},
): Promise<EmbeddingResult> {
  const identity = getEmbeddingIdentity();
  if (!identity) {
    return {
      embedding: await callEmbeddings({ input: text }),
      outcome: "disabled",
      keyDigest: "",
    };
  }

  const sourceVersion = `${identity.providerId}:${identity.modelId}`;
  const key = buildCacheKey({
    namespace: "embedding",
    scope: {
      projectId: options.projectId ?? null,
      providerId: identity.providerId,
      modelId: identity.modelId,
    },
    sourceVersion,
    identity: contentDigest(text),
  });

  const cached = await runtimeCache.getOrLoad({
    key,
    namespace: "embedding",
    projectId: options.projectId ?? null,
    sourceVersion,
    ttlSeconds: cacheTtlSeconds(),
    validate: isEmbedding,
    load: () => callEmbeddings({ input: text }),
  });

  return {
    embedding: cached.value,
    outcome: cached.outcome,
    keyDigest: cached.keyDigest,
  };
}

/** Embedding compatibility seam. The provider module owns model selection. */
export async function getEmbeddings(
  text: string,
  options: { projectId?: string | null } = {},
): Promise<number[]> {
  return (await getEmbeddingsWithCache(text, options)).embedding;
}
