import { prisma } from "@/lib/prisma";
import type { ArtifactType } from "@prisma/client";
import type { ResolvedArtifact } from "../types";

/**
 * Latest-version artifact retrieval, moved verbatim from `buildNodeContext`.
 * One `findFirst` per consumed type over `(projectId, type)`; missing types
 * are skipped (no empty placeholder). Direct Prisma access is intentional:
 * retrieval ownership is what this boundary extracts.
 */
export async function retrieveArtifacts(
  projectId: string,
  types: ArtifactType[],
): Promise<ResolvedArtifact[]> {
  const resolved: ResolvedArtifact[] = [];
  for (const type of types) {
    const artifact = await prisma.artifact.findFirst({
      where: { projectId, type },
      orderBy: { version: "desc" },
    });
    if (artifact) {
      resolved.push({
        type: artifact.type,
        version: artifact.version,
        content: artifact.content,
      });
    }
  }
  return resolved;
}
