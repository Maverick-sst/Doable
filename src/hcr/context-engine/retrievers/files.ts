import { prisma } from "@/lib/prisma";
import type { ProjectFileEntry } from "../types";

/**
 * Project file-list retrieval. Same scope and selected fields as before, plus
 * `updatedAt` for provenance. No filesystem access — this reads the persisted
 * file index only.
 */
export async function retrieveFiles(
  projectId: string,
): Promise<ProjectFileEntry[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      files: {
        select: { id: true, path: true, embeddingStatus: true, updatedAt: true },
      },
    },
  });
  return (project?.files ?? []).map((file) => ({
    id: file.id,
    path: file.path,
    embeddingStatus: file.embeddingStatus,
    updatedAt: file.updatedAt.toISOString(),
  }));
}
