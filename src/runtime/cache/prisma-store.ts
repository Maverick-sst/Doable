import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CacheStore, CacheStoreEntry, CacheStoreRead } from "./types";

/**
 * Durable cache adapter. The table is derived state: a read/write failure is
 * reported as a cache failure and must never change the caller's result.
 */
export const prismaCacheStore: CacheStore = {
  async read(key: string): Promise<CacheStoreRead | null> {
    const entry = await prisma.derivedCache.findUnique({
      where: { key },
      select: { value: true, expiresAt: true },
    });
    if (!entry) return null;
    return { value: entry.value, expiresAt: entry.expiresAt };
  },

  async write(entry: CacheStoreEntry): Promise<void> {
    const value = entry.value as Prisma.InputJsonValue;
    await prisma.derivedCache.upsert({
      where: { key: entry.key },
      create: {
        key: entry.key,
        namespace: entry.namespace,
        projectId: entry.projectId,
        scopeKey: entry.scopeKey,
        sourceVersion: entry.sourceVersion,
        value,
        expiresAt: entry.expiresAt,
      },
      update: {
        namespace: entry.namespace,
        projectId: entry.projectId,
        scopeKey: entry.scopeKey,
        sourceVersion: entry.sourceVersion,
        value,
        expiresAt: entry.expiresAt,
      },
    });
  },

  async deleteProject(projectId: string): Promise<number> {
    const result = await prisma.derivedCache.deleteMany({
      where: { projectId },
    });
    return result.count;
  },

  async deleteExpired(now: Date): Promise<number> {
    const result = await prisma.derivedCache.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return result.count;
  },
};
