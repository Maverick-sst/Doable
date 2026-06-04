import { prisma } from "@/lib/prisma";
import { ArtifactType, NodeType, Prisma } from "@prisma/client";

interface CreateArtifactInput {
  projectId: string;
  workflowId: string;
  executionId?: string;
  nodeId?: string;
  type: ArtifactType;
  producedBy: NodeType;
  content: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export async function createArtifact(input: CreateArtifactInput) {
  // 1. Find the latest version of this artifact type for this project+workflow
  const latest = await prisma.artifact.findFirst({
    where: {
      projectId: input.projectId,
      workflowId: input.workflowId,
      type: input.type,
    },
    orderBy: { version: "desc" },
  });

  const nextVersion = latest ? latest.version + 1 : 1;

  // 2. Create the artifact (NEVER update — always create new version)
  const artifact = await prisma.artifact.create({
    data: {
      projectId: input.projectId,
      workflowId: input.workflowId,
      executionId: input.executionId ?? null,
      nodeId: input.nodeId ?? null,
      type: input.type,
      version: nextVersion,
      producedBy: input.producedBy,
      content: input.content as Prisma.InputJsonValue,
      metadata: (input.metadata as Prisma.InputJsonValue) ?? null,
    },
  });

  // 3. Emit a runtime event for observability
  if (input.executionId) {
    await prisma.runtimeEvent.create({
      data: {
        executionId: input.executionId,
        nodeId: input.nodeId ?? null,
        type: "artifact.created",
        payload: {
          artifactId: artifact.id,
          artifactType: artifact.type,
          version: artifact.version,
          workflowId: artifact.workflowId,
        },
      },
    });
  }

  return artifact;
}
