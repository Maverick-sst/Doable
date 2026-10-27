import { MemoryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { collectMemoryCandidates } from "./candidates";
import { embedMemoryEntries } from "./embeddings";
import { mergeMemoryCandidates } from "./merge";
import type {
  MemoryCurationResult,
  MemoryCurationTrigger,
} from "./types";

export interface RunMemoryCurationInput {
  projectId: string;
  userId?: string | null;
  trigger: MemoryCurationTrigger;
  executionId?: string | null;
}

/**
 * One bounded curation pass: collect → merge (conflicts/idempotency) →
 * embed → prune. Safe to replay; the contentKey makes duplicates no-ops.
 */
export async function runMemoryCuration(
  input: RunMemoryCurationInput,
): Promise<MemoryCurationResult> {
  const candidates = await collectMemoryCandidates({
    projectId: input.projectId,
    trigger: input.trigger,
    executionId: input.executionId,
  });

  const merge = await mergeMemoryCandidates({
    projectId: input.projectId,
    userId: input.userId,
    candidates,
  });

  const embedding = await embedMemoryEntries(merge.insertedIds);
  const pruned = await pruneExpiredMemory(input.projectId);

  return {
    collected: candidates.length,
    inserted: merge.inserted,
    superseded: merge.superseded,
    unchanged: merge.unchanged,
    skipped: merge.skipped,
    embedded: embedding.embedded,
    embedSkipped: embedding.skipped,
    embedFailed: embedding.failed,
    pruned,
  };
}

/** Eligible for expiry are ACTIVE episodic rows past their retention date. */
export async function pruneExpiredMemory(projectId?: string): Promise<number> {
  const now = new Date();
  const expired = await prisma.memoryEntry.findMany({
    where: {
      status: MemoryStatus.ACTIVE,
      expiresAt: { lt: now },
      ...(projectId ? { projectId } : {}),
    },
    select: { id: true },
  });
  if (expired.length === 0) return 0;

  const ids = expired.map((entry) => entry.id);
  await prisma.$transaction(async (tx) => {
    await tx.memoryEntry.updateMany({
      where: { id: { in: ids }, status: MemoryStatus.ACTIVE },
      data: {
        status: MemoryStatus.DELETED,
        deletedAt: now,
        deletionReason: "expired",
      },
    });
    for (const id of ids) {
      await tx.$executeRaw`
        UPDATE "MemoryEntry"
        SET "embedding" = NULL,
            "embeddingStatus" = 'EMBEDDING_PENDING'
        WHERE "id" = ${id}`;
    }
  });

  return ids.length;
}

/**
 * Soft-deletes one entry and clears its derived vector. The row stays for
 * audit; retrieval only reads ACTIVE entries.
 */
export async function deleteMemoryEntry(input: {
  id: string;
  reason: string;
}): Promise<boolean> {
  const entry = await prisma.memoryEntry.findUnique({
    where: { id: input.id },
    select: { id: true, projectId: true, subject: true, userId: true },
  });
  if (!entry) return false;
  return deleteSubjectRows({
    ids: [entry.id],
    reason: input.reason,
  });
}

/**
 * Deletion propagation: removes every version (active, superseded) of a
 * logical memory subject and clears its embedding. Future derived caches must
 * subscribe here as well.
 */
export async function deleteMemorySubject(input: {
  projectId: string;
  subject: string;
  userId?: string | null;
  reason: string;
}): Promise<number> {
  const rows = await prisma.memoryEntry.findMany({
    where: {
      projectId: input.projectId,
      subject: input.subject,
      userId: input.userId ?? null,
      status: { not: MemoryStatus.DELETED },
    },
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  await deleteSubjectRows({
    ids: rows.map((row) => row.id),
    reason: input.reason,
  });
  return rows.length;
}

async function deleteSubjectRows(input: {
  ids: string[];
  reason: string;
}): Promise<boolean> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.memoryEntry.updateMany({
      where: { id: { in: input.ids } },
      data: {
        status: MemoryStatus.DELETED,
        deletedAt: now,
        deletionReason: input.reason,
      },
    });
    for (const id of input.ids) {
      await tx.$executeRaw`
        UPDATE "MemoryEntry"
        SET "embedding" = NULL,
            "embeddingStatus" = 'EMBEDDING_PENDING',
            "supersededById" = NULL
        WHERE "id" = ${id}`;
    }
  });
  return true;
}

/**
 * Writes an explicit user correction. Corrections outrank curated memory for
 * the same subject (see `decideMemoryMerge`).
 */
export async function recordMemoryCorrection(input: {
  projectId: string;
  userId?: string | null;
  kind: import("@prisma/client").MemoryKind;
  subject: string;
  content: string;
  sourceId?: string | null;
}): Promise<{ id: string | null; inserted: boolean }> {
  const result = await mergeMemoryCandidates({
    projectId: input.projectId,
    userId: input.userId,
    candidates: [
      {
        scope: "PROJECT",
        kind: input.kind,
        subject: input.subject,
        content: input.content,
        confidence: 1,
        sourceKind: "user-correction",
        sourceId: input.sourceId ?? null,
      },
    ],
  });
  return {
    id: result.insertedIds[0] ?? null,
    inserted: result.inserted > 0,
  };
}
