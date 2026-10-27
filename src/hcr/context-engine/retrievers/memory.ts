import { prisma } from "@/lib/prisma";
import type { MemoryContext } from "../types";

/**
 * Curated project memory. One row per project today; the layered memory model
 * (working/episodic/semantic) is D4. Absence is not an error — callers get
 * `null` and the manifest simply has no memory source.
 */
export async function retrieveProjectMemory(
  projectId: string,
): Promise<MemoryContext | null> {
  const memory = await prisma.projectMemory.findUnique({
    where: { projectId },
    select: {
      summary: true,
      requirements: true,
      techStack: true,
      updatedAt: true,
    },
  });
  if (!memory) return null;

  return {
    summary: memory.summary,
    requirements: memory.requirements,
    techStack: memory.techStack,
    updatedAt: memory.updatedAt.toISOString(),
  };
}
