import { prisma } from "@/lib/prisma";
import type { RelevantFile } from "@/src/shared/types";
import type { RelevantFileContext } from "../types";

/**
 * pgvector semantic file retrieval, moved verbatim from `buildNodeContext`.
 * Same filter (`EMBEDDING_SUCCESSFUL` within project), same similarity
 * ordering, same top-5, same 700-char truncation. Empty embeddings yield no
 * rows (the policy-flag gate stays with the orchestrator). No new vector
 * store, model, or ranking — extraction only.
 */
export async function retrieveRelevantFiles(
  projectId: string,
  promptEmbedding: number[],
): Promise<RelevantFileContext[]> {
  if (promptEmbedding.length === 0) {
    return [];
  }

  const promptEmbeddingString = `[${promptEmbedding.join(",")}]`;
  const rows = await prisma.$queryRaw<RelevantFile[]>`
    SELECT id, path, content FROM "File"
    WHERE "projectId" = ${projectId}
      AND "embeddingStatus" = 'EMBEDDING_SUCCESSFUL'
    ORDER BY embedding <=> ${promptEmbeddingString}::vector
    LIMIT 5`;

  return rows.map((file) => ({
    path: file.path,
    snippet:
      file.content.slice(0, 700) + (file.content.length > 700 ? "..." : ""),
  }));
}
