import { prisma } from "@/lib/prisma";
import { ArtifactType } from "@prisma/client";

export async function getLatestArtifact(
  projectId: string,
  type: ArtifactType
) {
  return prisma.artifact.findFirst({
    where: { projectId, type },
    orderBy: { version: "desc" },
  });
}
