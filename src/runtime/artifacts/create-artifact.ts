import { createHash } from "node:crypto";
import { ArtifactType, NodeType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface CreateArtifactInput {
  projectId: string;
  workflowId: string;
  executionId?: string;
  nodeId?: string;
  type: ArtifactType;
  producedBy: NodeType;
  content: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  schemaVersion?: number;
  validationStatus?: "VALID" | "INVALID" | "UNKNOWN";
}

export type ArtifactRecord = Awaited<
  ReturnType<typeof prisma.artifact.create>
>;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function hashArtifactContent(content: unknown): string {
  return createHash("sha256").update(stableStringify(content)).digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * The only artifact write seam.
 *
 * Revision scope is monotonic per (projectId, type), so a later workflow can
 * never lose to an earlier workflow that happened to have a higher local
 * version. Provenance (workflow/execution/node) is stored on every row.
 *
 * A node id is idempotent: retries return the artifact already produced for
 * that node instead of creating a duplicate. The unique index backs that
 * guarantee under concurrent delivery.
 */
export async function createArtifact(
  input: CreateArtifactInput,
): Promise<ArtifactRecord> {
  if (input.nodeId) {
    const existing = await prisma.artifact.findUnique({
      where: { nodeId: input.nodeId },
    });
    if (existing) return existing;
  }

  const contentHash = hashArtifactContent(input.content);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const latest = await tx.artifact.findFirst({
          where: { projectId: input.projectId, type: input.type },
          orderBy: { version: "desc" },
          select: { version: true },
        });

        const artifact = await tx.artifact.create({
          data: {
            projectId: input.projectId,
            workflowId: input.workflowId,
            executionId: input.executionId ?? null,
            nodeId: input.nodeId ?? null,
            type: input.type,
            version: (latest?.version ?? 0) + 1,
            schemaVersion: input.schemaVersion ?? 1,
            validationStatus: input.validationStatus ?? "VALID",
            contentHash,
            producedBy: input.producedBy,
            content: input.content as Prisma.InputJsonValue,
            metadata: (input.metadata as Prisma.InputJsonValue) ?? null,
          },
        });

        if (input.executionId) {
          await tx.runtimeEvent.create({
            data: {
              executionId: input.executionId,
              nodeId: input.nodeId ?? null,
              type: "artifact.created",
              payload: {
                artifactId: artifact.id,
                artifactType: artifact.type,
                version: artifact.version,
                schemaVersion: artifact.schemaVersion,
                contentHash: artifact.contentHash,
                workflowId: artifact.workflowId,
              },
            },
          });
        }

        return artifact;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      // A concurrent writer won the version or node-id race. A node artifact
      // is idempotent; a version race can be retried with a fresh read.
      if (input.nodeId) {
        const existing = await prisma.artifact.findUnique({
          where: { nodeId: input.nodeId },
        });
        if (existing) return existing;
      }
      if (attempt === 2) throw error;
    }
  }

  throw new Error("Artifact creation failed after concurrent retries");
}