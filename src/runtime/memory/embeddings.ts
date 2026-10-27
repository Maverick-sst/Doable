import { MemoryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmbeddings } from "@/lib/embeddings";
import { getProviderCapabilitiesOrNull } from "@/src/providers";
import { MEMORY_MAX_CONTENT_CHARS } from "./policy";
import type { MemoryEmbeddingResult } from "./types";

const MAX_EMBEDDINGS_PER_RUN = 40;

/**
 * Embeds new memory entries. A provider without an embedding endpoint leaves
 * rows pending (lexical retrieval still works); an embedding failure marks
 * only that row and never fails curation.
 */
export async function embedMemoryEntries(
  ids: string[],
): Promise<MemoryEmbeddingResult> {
  const result: MemoryEmbeddingResult = {
    embedded: 0,
    skipped: 0,
    failed: 0,
  };
  if (ids.length === 0) return result;

  if (!getProviderCapabilitiesOrNull()?.embeddings) {
    result.skipped = ids.length;
    return result;
  }

  const batch = ids.slice(0, MAX_EMBEDDINGS_PER_RUN);
  result.skipped += ids.length - batch.length;

  for (const id of batch) {
    const entry = await prisma.memoryEntry.findFirst({
      where: { id, status: MemoryStatus.ACTIVE },
      select: { id: true, content: true, projectId: true },
    });
    if (!entry) {
      result.skipped++;
      continue;
    }

    // updateMany, not update: a project can be deleted between collection
    // and embedding, and a missing row is a skip, not a curation failure.
    const claimed = await prisma.memoryEntry.updateMany({
      where: { id, status: MemoryStatus.ACTIVE },
      data: { embeddingStatus: "EMBEDDING_PROCESSING" },
    });
    if (claimed.count === 0) {
      result.skipped++;
      continue;
    }

    try {
      const embedding = await getEmbeddings(
        entry.content.slice(0, MEMORY_MAX_CONTENT_CHARS),
        { projectId: entry.projectId },
      );
      const vector = `[${embedding.join(",")}]`;
      await prisma.$executeRaw`
        UPDATE "MemoryEntry"
        SET "embedding" = ${vector}::vector,
            "embeddingStatus" = 'EMBEDDING_SUCCESSFUL'
        WHERE "id" = ${id}`;
      result.embedded++;
    } catch {
      await prisma.memoryEntry.updateMany({
        where: { id },
        data: { embeddingStatus: "EMBEDDING_FAILED" },
      });
      result.failed++;
    }
  }

  return result;
}
