import { prisma } from "@/lib/prisma";
import type { RelevantFileContext } from "../types";

/** Per-file snippet bound; unchanged from the pre-V2 behavior. */
export const RELEVANT_FILE_SNIPPET_CHARS = 700;

type RelevantFileRow = {
  id: string;
  path: string;
  content: string;
  updatedAt: Date;
};

/**
 * pgvector semantic file retrieval. Same filter (`EMBEDDING_SUCCESSFUL`),
 * similarity ordering, top-5, and 700-char truncation as before, now with the
 * file id and `updatedAt` so the selection can report provenance.
 */
export async function retrieveRelevantFiles(
  projectId: string,
  promptEmbedding: number[],
): Promise<RelevantFileContext[]> {
  if (promptEmbedding.length === 0) {
    return [];
  }

  const promptEmbeddingString = `[${promptEmbedding.join(",")}]`;
  const rows = await prisma.$queryRaw<RelevantFileRow[]>`
    SELECT id, path, content, "updatedAt" FROM "File"
    WHERE "projectId" = ${projectId}
      AND "embeddingStatus" = 'EMBEDDING_SUCCESSFUL'
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${promptEmbeddingString}::vector
    LIMIT 5`;

  return rows.map((file) => ({
    id: file.id,
    path: file.path,
    snippet:
      file.content.slice(0, RELEVANT_FILE_SNIPPET_CHARS) +
      (file.content.length > RELEVANT_FILE_SNIPPET_CHARS ? "..." : ""),
    updatedAt: file.updatedAt.toISOString(),
  }));
}
