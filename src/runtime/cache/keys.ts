import { createHash } from "node:crypto";
import type { CacheKey, CacheScope } from "./types";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalScope(scope: CacheScope): string {
  const entries = Object.entries({
    projectId: scope.projectId ?? null,
    userId: scope.userId ?? null,
    agentType: scope.agentType ?? null,
    configHash: scope.configHash ?? null,
    providerId: scope.providerId ?? null,
    modelId: scope.modelId ?? null,
  }).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries);
}

/**
 * A cache key is a function of namespace, tenant/agent/config scope, the
 * source version that produced the value, and the source identity itself.
 * Changing a model, agent config, or source content therefore misses the old
 * entry instead of reusing a stale value.
 */
export function buildCacheKey(input: {
  namespace: string;
  scope?: CacheScope;
  sourceVersion: string;
  identity: string;
}): CacheKey {
  const scopeKey = canonicalScope(input.scope ?? {});
  const digest = hash(
    [input.namespace, scopeKey, input.sourceVersion, input.identity].join("\n"),
  );
  const project = input.scope?.projectId ?? "global";
  return {
    key: `${input.namespace}:${project}:${digest}`,
    digest,
    scopeKey,
  };
}

/** Identity for content-addressed derived values. */
export function contentDigest(value: string): string {
  return hash(value);
}
