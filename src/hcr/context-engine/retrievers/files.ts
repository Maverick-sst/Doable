import { prisma } from "@/lib/prisma";

/** Project file entry as the file-tree section consumes it. */
export interface ProjectFileEntry {
  id: string;
  path: string;
  embeddingStatus: string;
}

/**
 * Project file-list retrieval, moved verbatim from `node-executor`.
 * Same scope (single project), same selected fields, same empty-project
 * behavior (`[]` when the project row is missing). No filesystem access —
 * this reads the persisted file index only.
 */
export async function retrieveFiles(
  projectId: string,
): Promise<ProjectFileEntry[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      files: { select: { id: true, path: true, embeddingStatus: true } },
    },
  });
  return project?.files ?? [];
}
