import { describe, expect, test } from "bun:test";
import {
  buildCacheKey,
  contentDigest,
  MemoryCacheStore,
  RuntimeCache,
} from "@/src/runtime/cache";
import type { CacheStore, CacheStoreEntry } from "@/src/runtime/cache";

function key(overrides: Partial<Parameters<typeof buildCacheKey>[0]> = {}) {
  return buildCacheKey({
    namespace: "embedding",
    scope: { projectId: "p1", providerId: "ollama", modelId: "nomic" },
    sourceVersion: "ollama:nomic",
    identity: "content",
    ...overrides,
  });
}

describe("cache keys", () => {
  test("are stable for identical inputs and contain no raw content", () => {
    const first = key({ identity: "secret prompt text" });
    const second = key({ identity: "secret prompt text" });
    expect(first.key).toBe(second.key);
    expect(first.key).not.toContain("secret prompt text");
  });

  test("change with project, agent config, model, source version, and content", () => {
    const base = key().key;
    expect(key({ scope: { projectId: "p2" } }).key).not.toBe(base);
    expect(
      key({ scope: { projectId: "p1", agentType: "builder" } }).key,
    ).not.toBe(base);
    expect(
      key({ scope: { projectId: "p1", configHash: "cfg2" } }).key,
    ).not.toBe(base);
    expect(
      key({ scope: { projectId: "p1", modelId: "other" } }).key,
    ).not.toBe(base);
    expect(key({ sourceVersion: "v2" }).key).not.toBe(base);
    expect(key({ identity: "other" }).key).not.toBe(base);
  });

  test("content digest is deterministic", () => {
    expect(contentDigest("abc")).toBe(contentDigest("abc"));
    expect(contentDigest("abc")).not.toBe(contentDigest("abd"));
  });
});

describe("runtime cache", () => {
  test("serves hot, then durable, with one loader call", async () => {
    const now = () => 1_000;
    const store = new MemoryCacheStore(now);
    const cache = new RuntimeCache({ store, now });
    let loads = 0;
    const load = async () => {
      loads += 1;
      return [1, 2, 3];
    };
    const cacheKey = key();

    const first = await cache.getOrLoad({
      key: cacheKey,
      namespace: "embedding",
      projectId: "p1",
      ttlSeconds: 60,
      load,
    });
    expect(first.outcome).toBe("miss");
    expect(first.value).toEqual([1, 2, 3]);

    const hot = await cache.getOrLoad({
      key: cacheKey,
      namespace: "embedding",
      projectId: "p1",
      ttlSeconds: 60,
      load,
    });
    expect(hot.outcome).toBe("hit_hot");
    expect(loads).toBe(1);

    const restarted = new RuntimeCache({ store, now });
    const durable = await restarted.getOrLoad({
      key: cacheKey,
      namespace: "embedding",
      projectId: "p1",
      ttlSeconds: 60,
      load,
    });
    expect(durable.outcome).toBe("hit_durable");
    expect(durable.value).toEqual([1, 2, 3]);
    expect(loads).toBe(1);
    expect(restarted.snapshot().namespaces[0]?.hits).toBe(1);
  });

  test("expired entries are misses", async () => {
    const now = () => 1_000;
    const store = new MemoryCacheStore(now);
    const cache = new RuntimeCache({ store, now });
    let loads = 0;
    const load = async () => {
      loads += 1;
      return "value";
    };

    await cache.getOrLoad({
      key: key(),
      namespace: "embedding",
      projectId: "p1",
      ttlSeconds: 0,
      load,
    });
    const restarted = new RuntimeCache({ store, now });
    const second = await restarted.getOrLoad({
      key: key(),
      namespace: "embedding",
      projectId: "p1",
      ttlSeconds: 0,
      load,
    });
    expect(second.outcome).toBe("miss");
    expect(loads).toBe(2);
  });

  test("invalidates one project without touching another", async () => {
    const store = new MemoryCacheStore();
    const cache = new RuntimeCache({ store });
    const load = async (value: string) => value;

    await cache.getOrLoad({
      key: key({ scope: { projectId: "p1" } }),
      namespace: "embedding",
      projectId: "p1",
      ttlSeconds: 60,
      load: () => load("one"),
    });
    await cache.getOrLoad({
      key: key({ scope: { projectId: "p2" } }),
      namespace: "embedding",
      projectId: "p2",
      ttlSeconds: 60,
      load: () => load("two"),
    });

    expect(await cache.invalidateProject("p1")).toBe(1);
    expect(cache.snapshot().hotEntries).toBe(1);

    const p2 = await cache.getOrLoad({
      key: key({ scope: { projectId: "p2" } }),
      namespace: "embedding",
      projectId: "p2",
      ttlSeconds: 60,
      load: () => load("reloaded"),
    });
    expect(p2.value).toBe("two");
    expect(store.size()).toBe(1);
  });

  test("falls through when the durable adapter fails", async () => {
    const failing: CacheStore = {
      async read() {
        throw new Error("db down");
      },
      async write() {
        throw new Error("db down");
      },
      async deleteProject() {
        throw new Error("db down");
      },
      async deleteExpired() {
        throw new Error("db down");
      },
    };
    const cache = new RuntimeCache({ store: failing });
    const result = await cache.getOrLoad({
      key: key(),
      namespace: "embedding",
      projectId: "p1",
      ttlSeconds: 60,
      load: async () => [9, 8, 7],
    });

    expect(result.outcome).toBe("failure");
    expect(result.value).toEqual([9, 8, 7]);
    const metrics = cache.snapshot().namespaces[0];
    expect(metrics?.misses).toBe(1);
    expect(metrics?.failures).toBeGreaterThanOrEqual(2);
  });

  test("rejects a poisoned durable value and reloads", async () => {
    const store = new MemoryCacheStore();
    const cache = new RuntimeCache({ store });
    const cacheKey = key();
    const entry: CacheStoreEntry = {
      key: cacheKey.key,
      namespace: "embedding",
      projectId: "p1",
      scopeKey: cacheKey.scopeKey,
      sourceVersion: "ollama:nomic",
      value: "not a vector",
      expiresAt: new Date(Date.now() + 60_000),
    };
    await store.write(entry);

    let loads = 0;
    const result = await cache.getOrLoad({
      key: cacheKey,
      namespace: "embedding",
      projectId: "p1",
      ttlSeconds: 60,
      validate: (value): value is number[] =>
        Array.isArray(value) &&
        value.every((item) => typeof item === "number"),
      load: async () => {
        loads += 1;
        return [1, 1, 1];
      },
    });

    expect(loads).toBe(1);
    expect(result.outcome).toBe("miss");
    expect(result.value).toEqual([1, 1, 1]);
    expect(cache.snapshot().namespaces[0]?.failures).toBe(1);
  });

  test("deduplicates concurrent misses", async () => {
    const cache = new RuntimeCache({ store: new MemoryCacheStore() });
    let loads = 0;
    const load = async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "shared";
    };
    const input = {
      key: key(),
      namespace: "embedding",
      projectId: "p1",
      ttlSeconds: 60,
      load,
    };

    const [first, second] = await Promise.all([
      cache.getOrLoad(input),
      cache.getOrLoad(input),
    ]);
    expect(loads).toBe(1);
    expect(first.value).toBe("shared");
    expect(second.value).toBe("shared");
    expect([first.outcome, second.outcome].sort()).toEqual([
      "hit_inflight",
      "miss",
    ]);
  });

  test("bypasses storage when disabled", async () => {
    const cache = new RuntimeCache({
      store: new MemoryCacheStore(),
      enabled: false,
    });
    const result = await cache.getOrLoad({
      key: key(),
      namespace: "embedding",
      ttlSeconds: 60,
      load: async () => "fresh",
    });
    expect(result.outcome).toBe("disabled");
    expect(result.value).toBe("fresh");
    expect(cache.snapshot().hotEntries).toBe(0);
  });
});
