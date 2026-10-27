import type {
  CacheJson,
  CacheStore,
  CacheStoreEntry,
  CacheStoreRead,
} from "./types";

/**
 * In-memory adapter for tests and drills. It mirrors the Prisma semantics,
 * including expiry and project-scoped deletion.
 */
export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheStoreEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  async read(key: string): Promise<CacheStoreRead | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt.getTime() <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return { value: entry.value as CacheJson, expiresAt: entry.expiresAt };
  }

  async write(entry: CacheStoreEntry): Promise<void> {
    this.entries.set(entry.key, entry);
  }

  async deleteProject(projectId: string): Promise<number> {
    let deleted = 0;
    for (const [key, entry] of this.entries) {
      if (entry.projectId === projectId) {
        this.entries.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  async deleteExpired(now: Date): Promise<number> {
    let deleted = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt.getTime() <= now.getTime()) {
        this.entries.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  size(): number {
    return this.entries.size;
  }
}
