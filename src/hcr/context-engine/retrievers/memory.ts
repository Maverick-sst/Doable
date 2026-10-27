import { MemoryKind, MemoryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { MemoryContext } from "../types";

export const DEFAULT_MEMORY_LIMIT = 12;
const MAX_VECTOR_CANDIDATES = 8;

const KIND_PRIORITY: Record<string, number> = {
  [MemoryKind.PREFERENCE]: 0,
  [MemoryKind.SEMANTIC]: 1,
  [MemoryKind.PROCEDURAL]: 2,
  [MemoryKind.EPISODIC]: 3,
  [MemoryKind.WORKING]: 4,
};

interface MemoryRow {
  id: string;
  kind: MemoryKind;
  subject: string;
  content: string;
  confidence: number;
  updatedAt: Date;
  sourceKind: string;
  sourceId: string | null;
}

function toContext(row: MemoryRow): MemoryContext {
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    content: row.content,
    confidence: row.confidence,
    updatedAt: row.updatedAt.toISOString(),
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
  };
}

async function retrieveVectorMatches(
  projectId: string,
  promptEmbedding: number[],
  limit: number,
): Promise<MemoryContext[]> {
  const vector = `[${promptEmbedding.join(",")}]`;
  const rows = await prisma.$queryRaw<MemoryRow[]>`
    SELECT id, kind, subject, content, confidence, "updatedAt",
           "sourceKind", "sourceId"
    FROM "MemoryEntry"
    WHERE "projectId" = ${projectId}
      AND status = 'ACTIVE'
      AND embedding IS NOT NULL
      AND "embeddingStatus" = 'EMBEDDING_SUCCESSFUL'
    ORDER BY embedding <=> ${vector}::vector
    LIMIT ${limit}`;
  return rows.map(toContext);
}

async function retrieveRecentEntries(
  projectId: string,
  limit: number,
): Promise<MemoryContext[]> {
  const rows = await prisma.memoryEntry.findMany({
    where: { projectId, status: MemoryStatus.ACTIVE },
    take: Math.max(limit, DEFAULT_MEMORY_LIMIT),
    select: {
      id: true,
      kind: true,
      subject: true,
      content: true,
      confidence: true,
      updatedAt: true,
      sourceKind: true,
      sourceId: true,
    },
  });

  return rows
    .sort((a, b) => {
      const kindDelta =
        (KIND_PRIORITY[a.kind] ?? 9) - (KIND_PRIORITY[b.kind] ?? 9);
      if (kindDelta !== 0) return kindDelta;
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      const timeDelta = b.updatedAt.getTime() - a.updatedAt.getTime();
      if (timeDelta !== 0) return timeDelta;
      return a.id.localeCompare(b.id);
    })
    .slice(0, limit)
    .map(toContext);
}

/**
 * Layered memory retrieval. Semantic vector matches rank first when a prompt
 * embedding exists, then recent/confident entries fill the remainder.
 *
 * Before curation has produced entries, the legacy `ProjectMemory` summary is
 * used as a single synthetic entry so existing projects keep their context.
 */
export async function retrieveMemoryEntries(
  projectId: string,
  promptEmbedding: number[] = [],
  limit: number = DEFAULT_MEMORY_LIMIT,
): Promise<MemoryContext[]> {
  const [vectorMatches, recent] = await Promise.all([
    promptEmbedding.length > 0
      ? retrieveVectorMatches(
          projectId,
          promptEmbedding,
          Math.min(MAX_VECTOR_CANDIDATES, limit),
        )
      : Promise.resolve([]),
    retrieveRecentEntries(projectId, limit),
  ]);

  const merged: MemoryContext[] = [];
  const seen = new Set<string>();
  for (const entry of [...vectorMatches, ...recent]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
    if (merged.length >= limit) break;
  }
  if (merged.length > 0) return merged;

  const legacy = await prisma.projectMemory.findUnique({
    where: { projectId },
    select: { id: true, summary: true, updatedAt: true },
  });
  if (!legacy || !legacy.summary.trim()) return [];

  return [
    {
      id: `project-memory:${legacy.id}`,
      kind: MemoryKind.SEMANTIC,
      subject: "summary",
      content: legacy.summary,
      confidence: 0.9,
      updatedAt: legacy.updatedAt.toISOString(),
      sourceKind: "project-memory",
      sourceId: legacy.id,
    },
  ];
}
