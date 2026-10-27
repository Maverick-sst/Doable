/**
 * D6 cache drill. No network or database: it proves scoped/versioned keys,
 * hot and durable hits, TTL expiry, project invalidation, poisoned-value
 * reload, failure fallback, and concurrent miss sharing.
 *
 *   bun scripts/verify-cache.ts
 */
import {
  buildCacheKey,
  MemoryCacheStore,
  RuntimeCache,
} from "@/src/runtime/cache";
import type { CacheStore } from "@/src/runtime/cache";

function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function cacheKey(projectId = "drill-project", modelId = "nomic") {
  return buildCacheKey({
    namespace: "embedding",
    scope: { projectId, providerId: "ollama", modelId },
    sourceVersion: `ollama:${modelId}`,
    identity: "same source content",
  });
}

async function run(): Promise<void> {
  const now = () => 1_000;
  const store = new MemoryCacheStore(now);
  const cache = new RuntimeCache({ store, now });
  let loads = 0;
  const load = async () => {
    loads += 1;
    return [0.1, 0.2, 0.3];
  };

  const base = cacheKey();
  check(
    base.key !== cacheKey("other-project").key,
    "project changes the key",
  );
  check(
    base.key !== cacheKey("drill-project", "other-model").key,
    "model changes the key",
  );
  check(!base.key.includes("same source content"), "key hides source content");
  console.log("key scope: project and model both invalidate");

  const miss = await cache.getOrLoad({
    key: base,
    namespace: "embedding",
    projectId: "drill-project",
    ttlSeconds: 60,
    load,
  });
  check(miss.outcome === "miss" && loads === 1, "first lookup loads once");

  const hot = await cache.getOrLoad({
    key: base,
    namespace: "embedding",
    projectId: "drill-project",
    ttlSeconds: 60,
    load,
  });
  check(hot.outcome === "hit_hot" && loads === 1, "second lookup is a hot hit");
  console.log("layers: miss then hot hit without a second load");

  const restarted = new RuntimeCache({ store, now });
  const durable = await restarted.getOrLoad({
    key: base,
    namespace: "embedding",
    projectId: "drill-project",
    ttlSeconds: 60,
    load,
  });
  check(durable.outcome === "hit_durable" && loads === 1, "durable hit after restart");
  console.log("durable: restart reuses the stored value");

  const expiring = new RuntimeCache({ store, now });
  const key = cacheKey("expiry-project");
  await expiring.getOrLoad({
    key,
    namespace: "embedding",
    projectId: "expiry-project",
    ttlSeconds: 0,
    load,
  });
  const expired = await new RuntimeCache({ store, now }).getOrLoad({
    key,
    namespace: "embedding",
    projectId: "expiry-project",
    ttlSeconds: 0,
    load,
  });
  check(expired.outcome === "miss", "expired entry reloads");
  console.log("ttl: expired entries reload");

  const invalidated = await restarted.invalidateProject("drill-project");
  check(invalidated >= 1, "project invalidation removes durable rows");
  const afterDelete = await restarted.getOrLoad({
    key: base,
    namespace: "embedding",
    projectId: "drill-project",
    ttlSeconds: 60,
    load,
  });
  check(afterDelete.outcome === "miss", "project deletion forces a reload");
  console.log(`invalidate: project deletion removed ${invalidated} row(s)`);

  const poisonedStore = new MemoryCacheStore(now);
  const poisonedKey = cacheKey("poison-project");
  await poisonedStore.write({
    key: poisonedKey.key,
    namespace: "embedding",
    projectId: "poison-project",
    scopeKey: poisonedKey.scopeKey,
    sourceVersion: "drill",
    value: "not a vector",
    expiresAt: new Date(2_000),
  });
  let poisonLoads = 0;
  const repaired = await new RuntimeCache({
    store: poisonedStore,
    now,
  }).getOrLoad({
    key: poisonedKey,
    namespace: "embedding",
    projectId: "poison-project",
    ttlSeconds: 60,
    validate: (value): value is number[] =>
      Array.isArray(value) &&
      value.every((item) => typeof item === "number"),
    load: async () => {
      poisonLoads += 1;
      return [1, 2];
    },
  });
  check(repaired.outcome === "miss" && poisonLoads === 1, "invalid value reloads");
  console.log("correctness: a poisoned value is rejected and reloaded");

  const failing: CacheStore = {
    async read() {
      throw new Error("cache offline");
    },
    async write() {
      throw new Error("cache offline");
    },
    async deleteProject() {
      throw new Error("cache offline");
    },
    async deleteExpired() {
      throw new Error("cache offline");
    },
  };
  const fallback = await new RuntimeCache({ store: failing }).getOrLoad({
    key: base,
    namespace: "embedding",
    ttlSeconds: 60,
    load: async () => [7, 7],
  });
  check(
    fallback.outcome === "failure" && fallback.value[0] === 7,
    "cache failure still returns the source value",
  );
  console.log("failure: cache outage falls through to the source");

  const shared = new RuntimeCache({ store: new MemoryCacheStore(now), now });
  let sharedLoads = 0;
  const sharedKey = cacheKey("shared-project");
  const sharedLoad = async () => {
    sharedLoads += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return "one";
  };
  const input = {
    key: sharedKey,
    namespace: "embedding",
    projectId: "shared-project",
    ttlSeconds: 60,
    load: sharedLoad,
  };
  const [left, right] = await Promise.all([
    shared.getOrLoad(input),
    shared.getOrLoad(input),
  ]);
  check(
    sharedLoads === 1 && left.value === right.value,
    "concurrent misses share one load",
  );
  console.log("concurrency: concurrent misses share one load");
}

try {
  await run();
  console.log("D6 cache drill: PASS");
} catch (error) {
  console.error(
    `D6 cache drill: FAIL — ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
