import { prismaCacheStore } from "./prisma-store";
import type {
  CacheJson,
  CacheKey,
  CacheNamespaceMetrics,
  CacheOutcome,
  CacheSnapshot,
  CacheStore,
  CachedValue,
} from "./types";

interface HotEntry {
  value: CacheJson;
  expiresAt: Date;
  namespace: string;
  projectId: string | null;
}

interface CacheOptions {
  store: CacheStore;
  enabled?: boolean;
  hotEntries?: number;
  now?: () => number;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Two-layer application cache: a bounded in-process hot layer in front of a
 * durable store. Every failure path falls through to the loader, so a broken
 * cache changes latency, never the result.
 */
export class RuntimeCache {
  private readonly store: CacheStore;
  private readonly enabled: boolean;
  private readonly hotLimit: number;
  private readonly now: () => number;
  private readonly hot = new Map<string, HotEntry>();
  private readonly inFlight = new Map<string, Promise<CacheJson>>();
  private readonly metrics = new Map<string, CacheNamespaceMetrics>();

  constructor(options: CacheOptions) {
    this.store = options.store;
    this.enabled = options.enabled ?? true;
    this.hotLimit = options.hotEntries ?? 512;
    this.now = options.now ?? Date.now;
  }

  private metricsFor(namespace: string): CacheNamespaceMetrics {
    let current = this.metrics.get(namespace);
    if (!current) {
      current = {
        namespace,
        hits: 0,
        misses: 0,
        failures: 0,
        writes: 0,
        invalidations: 0,
      };
      this.metrics.set(namespace, current);
    }
    return current;
  }

  private setHot(
    key: CacheKey,
    namespace: string,
    projectId: string | null,
    value: CacheJson,
    expiresAt: Date,
  ): void {
    if (expiresAt.getTime() <= this.now()) return;
    this.hot.delete(key.key);
    this.hot.set(key.key, { value, expiresAt, namespace, projectId });
    while (this.hot.size > this.hotLimit) {
      const oldest = this.hot.keys().next().value;
      if (oldest === undefined) break;
      this.hot.delete(oldest);
    }
  }

  private readHot(key: CacheKey): CacheJson | null {
    const entry = this.hot.get(key.key);
    if (!entry) return null;
    if (entry.expiresAt.getTime() <= this.now()) {
      this.hot.delete(key.key);
      return null;
    }
    // Refresh recency for LRU behavior.
    this.hot.delete(key.key);
    this.hot.set(key.key, entry);
    return entry.value;
  }

  async getOrLoad<T extends CacheJson>(input: {
    key: CacheKey;
    namespace: string;
    projectId?: string | null;
    sourceVersion?: string;
    ttlSeconds: number;
    load: () => Promise<T>;
    validate?: (value: unknown) => value is T;
  }): Promise<CachedValue<T>> {
    const metrics = this.metricsFor(input.namespace);
    if (!this.enabled) {
      return {
        value: await input.load(),
        outcome: "disabled",
        keyDigest: input.key.digest,
      };
    }

    const hot = this.readHot(input.key);
    if (hot !== null) {
      metrics.hits += 1;
      return {
        value: hot as T,
        outcome: "hit_hot",
        keyDigest: input.key.digest,
      };
    }

    let readFailed = false;
    try {
      const durable = await this.store.read(input.key.key);
      if (durable) {
        if (durable.expiresAt.getTime() > this.now()) {
          const valid =
            !input.validate || input.validate(durable.value);
          if (valid) {
            metrics.hits += 1;
            this.setHot(
              input.key,
              input.namespace,
              input.projectId ?? null,
              durable.value as CacheJson,
              durable.expiresAt,
            );
            return {
              value: durable.value as T,
              outcome: "hit_durable",
              keyDigest: input.key.digest,
            };
          }
          metrics.failures += 1;
        }
      }
    } catch {
      readFailed = true;
      metrics.failures += 1;
    }

    const shared = this.inFlight.get(input.key.key);
    if (shared) {
      metrics.hits += 1;
      return {
        value: (await shared) as T,
        outcome: "hit_inflight",
        keyDigest: input.key.digest,
      };
    }

    metrics.misses += 1;
    const outcome: CacheOutcome = readFailed ? "failure" : "miss";
    const pending = this.loadAndStore(input, metrics);
    this.inFlight.set(input.key.key, pending as Promise<CacheJson>);
    try {
      const value = await pending;
      return {
        value,
        outcome,
        keyDigest: input.key.digest,
      };
    } finally {
      this.inFlight.delete(input.key.key);
    }
  }

  private async loadAndStore<T extends CacheJson>(
    input: {
      key: CacheKey;
      namespace: string;
      projectId?: string | null;
      sourceVersion?: string;
      ttlSeconds: number;
      load: () => Promise<T>;
    },
    metrics: CacheNamespaceMetrics,
  ): Promise<T> {
    const value = await input.load();
    const expiresAt = new Date(
      this.now() + Math.max(0, input.ttlSeconds) * 1_000,
    );
    this.setHot(
      input.key,
      input.namespace,
      input.projectId ?? null,
      value,
      expiresAt,
    );
    try {
      await this.store.write({
        key: input.key.key,
        namespace: input.namespace,
        projectId: input.projectId ?? null,
        scopeKey: input.key.scopeKey,
        sourceVersion: input.sourceVersion ?? input.key.digest,
        value,
        expiresAt,
      });
      metrics.writes += 1;
    } catch {
      // A durable write failure is a metric, not a caller-visible failure.
      metrics.failures += 1;
    }
    return value;
  }

  async invalidateProject(projectId: string): Promise<number> {
    for (const [key, entry] of this.hot) {
      if (entry.projectId === projectId) this.hot.delete(key);
    }
    let deleted = 0;
    try {
      deleted = await this.store.deleteProject(projectId);
    } catch {
      for (const entry of this.metrics.values()) entry.failures += 1;
    }
    for (const entry of this.metrics.values()) entry.invalidations += 1;
    return deleted;
  }

  async pruneExpired(): Promise<number> {
    let removed = 0;
    for (const [key, entry] of this.hot) {
      if (entry.expiresAt.getTime() <= this.now()) {
        this.hot.delete(key);
        removed += 1;
      }
    }
    try {
      removed += await this.store.deleteExpired(new Date(this.now()));
    } catch {
      for (const entry of this.metrics.values()) entry.failures += 1;
    }
    return removed;
  }

  snapshot(): CacheSnapshot {
    return {
      enabled: this.enabled,
      hotEntries: this.hot.size,
      namespaces: [...this.metrics.values()]
        .map((entry) => ({ ...entry }))
        .sort((left, right) => left.namespace.localeCompare(right.namespace)),
    };
  }

  reset(): void {
    this.hot.clear();
    this.inFlight.clear();
    this.metrics.clear();
  }
}

/** Process-wide cache used by derivation paths. */
export const runtimeCache = new RuntimeCache({
  store: prismaCacheStore,
  enabled: process.env.CACHE_DISABLED !== "true",
  hotEntries: positiveInt(process.env.CACHE_HOT_ENTRIES, 512),
});

export function cacheSnapshot(): CacheSnapshot {
  return runtimeCache.snapshot();
}

export async function invalidateProjectCache(
  projectId: string,
): Promise<number> {
  return runtimeCache.invalidateProject(projectId);
}

export async function pruneExpiredCache(): Promise<number> {
  return runtimeCache.pruneExpired();
}

export { buildCacheKey, contentDigest } from "./keys";
export { MemoryCacheStore } from "./memory-store";
export { prismaCacheStore } from "./prisma-store";
export type {
  CacheJson,
  CacheKey,
  CacheNamespaceMetrics,
  CacheOutcome,
  CacheScope,
  CacheSnapshot,
  CacheStore,
  CachedValue,
} from "./types";

export type { CacheStoreEntry, CacheStoreRead } from "./types";
