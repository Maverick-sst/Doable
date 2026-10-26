import { prisma } from "@/lib/prisma";
import { getEmbeddings } from "@/lib/embeddings";
import { getProviderCapabilities } from "@/src/providers";

const MAX_EMBEDDING_CHARS = 20_000;

export type EmbeddingOutcome = "embedded" | "empty" | "skipped" | "failed";

/**
 * Embedding seam. This replaces the previous background embedding job so local mode
 * has no hidden orchestration dependency. Failures degrade semantic search;
 * they never fail an already-committed file write.
 */
export async function embedFileContent(input: {
  projectId: string;
  fileId: string;
  content: string;
}): Promise<EmbeddingOutcome> {
  const text = input.content.slice(0, MAX_EMBEDDING_CHARS).trim();

  // Providers without an embedding endpoint must not make every file write
  // attempt a failing network call. Semantic search is optional.
  if (!getProviderCapabilities().embeddings) {
    return "skipped";
  }

  if (!text) {
    await prisma.file.updateMany({
      where: { id: input.fileId, projectId: input.projectId },
      data: { embeddingStatus: "EMBEDDING_SUCCESSFUL" },
    });
    return "empty";
  }

  await prisma.file.updateMany({
    where: { id: input.fileId, projectId: input.projectId },
    data: { embeddingStatus: "EMBEDDING_PROCESSING" },
  });

  try {
    const embedding = await getEmbeddings(text);
    const vector = `[${embedding.join(",")}]`;
    await prisma.$executeRaw`
      UPDATE "File"
      SET "embedding" = ${vector}::vector,
          "embeddingStatus" = 'EMBEDDING_SUCCESSFUL'
      WHERE "id" = ${input.fileId}
        AND "projectId" = ${input.projectId}`;
    return "embedded";
  } catch {
    await prisma.file.updateMany({
      where: { id: input.fileId, projectId: input.projectId },
      data: { embeddingStatus: "EMBEDDING_FAILED" },
    });
    return "failed";
  }
}