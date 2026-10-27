import { MemoryScope, MemoryStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  decideMemoryMerge,
  memoryContentHash,
  memoryContentKey,
  normalizeMemoryContent,
} from "./policy";
import type { MemoryCandidate, MemoryMergeResult } from "./types";

export interface MergeMemoryInput {
  projectId: string;
  userId?: string | null;
  candidates: MemoryCandidate[];
}

/**
 * Applies candidates to the memory table with conflict resolution.
 *
 * Idempotency is enforced by `contentKey` (owner + kind + subject + content
 * hash): replaying the same curation inserts nothing. Supersession keeps the
 * old row for audit and links the replacement.
 */
export async function mergeMemoryCandidates(
  input: MergeMemoryInput,
): Promise<MemoryMergeResult> {
  const result: MemoryMergeResult = {
    insertedIds: [],
    inserted: 0,
    superseded: 0,
    unchanged: 0,
    skipped: 0,
  };
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const candidate of input.candidates) {
      const content = normalizeMemoryContent(candidate.content);
      if (!content) {
        result.skipped++;
        continue;
      }

      const contentHash = memoryContentHash(content);
      const scope =
        candidate.scope === "USER" ? MemoryScope.USER : MemoryScope.PROJECT;
      const userId = scope === MemoryScope.USER ? input.userId ?? null : null;
      const contentKey = memoryContentKey({
        scope,
        projectId: input.projectId,
        userId,
        kind: candidate.kind,
        subject: candidate.subject,
        contentHash,
      });

      const alreadyStored = await tx.memoryEntry.findUnique({
        where: { contentKey },
        select: { status: true },
      });
      if (alreadyStored) {
        result.unchanged++;
        continue;
      }

      const active = await tx.memoryEntry.findFirst({
        where: {
          projectId: input.projectId,
          userId,
          kind: candidate.kind,
          subject: candidate.subject,
          status: MemoryStatus.ACTIVE,
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: { id: true, contentHash: true, sourceKind: true, status: true },
      });

      const decision = decideMemoryMerge(active, {
        contentHash,
        sourceKind: candidate.sourceKind,
      });

      if (decision === "noop") {
        result.unchanged++;
        continue;
      }
      if (decision === "skip") {
        result.skipped++;
        continue;
      }

      let created;
      try {
        created = await tx.memoryEntry.create({
          data: {
            scope,
            kind: candidate.kind,
            status: MemoryStatus.ACTIVE,
            subject: candidate.subject,
            content,
            data:
              candidate.data === undefined
                ? undefined
                : (candidate.data as Prisma.InputJsonValue),
            confidence: candidate.confidence,
            sourceKind: candidate.sourceKind,
            sourceId: candidate.sourceId ?? null,
            sourceRefs:
              candidate.sourceRefs === undefined
                ? undefined
                : (candidate.sourceRefs as unknown as Prisma.InputJsonValue),
            contentHash,
            contentKey,
            expiresAt: candidate.expiresAt
              ? new Date(candidate.expiresAt)
              : null,
            projectId: input.projectId,
            userId,
          },
          select: { id: true },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          result.unchanged++;
          continue;
        }
        throw error;
      }

      if (decision === "supersede" && active) {
        await tx.memoryEntry.updateMany({
          where: { id: active.id, status: MemoryStatus.ACTIVE },
          data: {
            status: MemoryStatus.SUPERSEDED,
            supersededById: created.id,
            supersededAt: now,
          },
        });
        result.superseded++;
      }

      result.insertedIds.push(created.id);
      result.inserted++;
    }
  });

  return result;
}
