/**
 * JSON-safe derived values. Cache entries never hold prompts, model output,
 * secrets, or file contents; callers cache vectors and summaries only.
 */
export type CacheJson =
  | string
  | number
  | boolean
  | null
  | CacheJson[]
  | { [key: string]: CacheJson };

/** Everything that makes a cache entry tenant- and configuration-specific. */
export interface CacheScope {
  projectId?: string | null;
  userId?: string | null;
  agentType?: string | null;
  configHash?: string | null;
  providerId?: string | null;
  modelId?: string | null;
}

export interface CacheKey {
  /** Storage key. Readable prefix plus a digest, never source content. */
  key: string;
  /** Keyed hash for telemetry and debugging without exposing the inputs. */
  digest: string;
  scopeKey: string;
}

export interface CacheStoreEntry {
  key: string;
  namespace: string;
  projectId: string | null;
  scopeKey: string;
  sourceVersion: string;
  value: CacheJson;
  expiresAt: Date;
}

export interface CacheStoreRead {
  value: unknown;
  expiresAt: Date;
}

/**
 * Adapter seam. A store must never decide correctness: the cache module treats
 * any thrown error as a miss/failure and still runs the loader.
 */
export interface CacheStore {
  read(key: string): Promise<CacheStoreRead | null>;
  write(entry: CacheStoreEntry): Promise<void>;
  deleteProject(projectId: string): Promise<number>;
  deleteExpired(now: Date): Promise<number>;
}

export type CacheOutcome =
  | "hit_hot"
  | "hit_durable"
  | "hit_inflight"
  | "miss"
  | "failure"
  | "disabled";

export interface CachedValue<T> {
  value: T;
  outcome: CacheOutcome;
  keyDigest: string;
}

export interface CacheNamespaceMetrics {
  namespace: string;
  hits: number;
  misses: number;
  failures: number;
  writes: number;
  invalidations: number;
}

export interface CacheSnapshot {
  enabled: boolean;
  hotEntries: number;
  namespaces: CacheNamespaceMetrics[];
}
