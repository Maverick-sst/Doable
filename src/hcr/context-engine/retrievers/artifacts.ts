import { prisma } from "@/lib/prisma";
import type { ArtifactType } from "@prisma/client";
import type { ResolvedArtifact } from "../types";

export interface ArtifactRetrieval {
  available: ResolvedArtifact[];
  /** Consumed types with no artifact yet — surfaced as missing provenance. */
  missing: ArtifactType[];
}

/**
 * Latest-version artifact retrieval. One query per consumed type over
 * `(projectId, type)`. Missing types are reported instead of silently
 * vanishing, so the context manifest can show an unavailable source.
 */
export async function retrieveArtifacts(
  projectId: string,
  types: ArtifactType[],
): Promise<ArtifactRetrieval> {
  const available: ResolvedArtifact[] = [];
  const missing: ArtifactType[] = [];

  for (const type of types) {
    const artifact = await prisma.artifact.findFirst({
      where: { projectId, type },
      orderBy: { version: "desc" },
      select: {
        id: true,
        type: true,
        version: true,
        content: true,
        createdAt: true,
      },
    });
    if (artifact) {
      available.push({
        id: artifact.id,
        type: artifact.type,
        version: artifact.version,
        content: artifact.content,
        createdAt: artifact.createdAt.toISOString(),
      });
    } else {
      missing.push(type);
    }
  }

  return { available, missing };
}
