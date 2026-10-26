import {
  ArtifactType,
  ExecutionStatus,
  NodeStatus,
  NodeType,
  Prisma,
  ProjectStatus,
  WorkflowStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createArtifact } from "@/src/runtime/artifacts/create-artifact";
import { validateArtifact } from "@/src/cognition/types/artifact-validators";

interface CompleteDiscoveryInput {
  projectId: string;
  workflowId: string;
  executionId: string;
  nodeId: string;
  discoveryResult: {
    domain: string;
    requirements: Record<string, unknown>;
    techStack: Record<string, unknown>;
    rawMessage: string;
  };
}

export async function completeDiscoveryWorkflow(input: CompleteDiscoveryInput) {
  const { projectId, workflowId, executionId, nodeId, discoveryResult } = input;

  const content = validateArtifact(ArtifactType.DISCOVERY_REQUIREMENT, {
    projectIntent: {
      summary: discoveryResult.rawMessage,
      domain: discoveryResult.domain,
      projectType:
        discoveryResult.domain === "LANDING_PAGE"
          ? "Landing Page"
          : "Full Stack App",
    },
    coreFeatures: discoveryResult.requirements.features ?? [],
    userFlows: discoveryResult.requirements.userFlows ?? [],
    constraints: {
      technical: discoveryResult.requirements.technicalConstraints ?? [],
      product: discoveryResult.requirements.productConstraints ?? [],
      business: [],
    },
    techStack: discoveryResult.techStack,
    dataEntities: discoveryResult.requirements.dataEntities ?? [],
    authRequirements: discoveryResult.requirements.authRequirements ?? [],
    integrations: discoveryResult.requirements.integrations ?? [],
    assumptions: discoveryResult.requirements.assumptions ?? [],
    knownAmbiguities: discoveryResult.requirements.ambiguities ?? [],
    confidenceScore: 0.8,
  });

  // Artifact first: it is the durable contract. Its nodeId key makes a retry
  // return the same artifact instead of creating a second revision.
  const artifact = await createArtifact({
    projectId,
    workflowId,
    executionId,
    nodeId,
    type: ArtifactType.DISCOVERY_REQUIREMENT,
    producedBy: NodeType.DISCOVERY,
    content,
  });

  await prisma.$transaction(async (tx) => {
    await tx.projectMemory.update({
      where: { projectId },
      data: {
        requirements: discoveryResult.requirements as Prisma.InputJsonValue,
        techStack: discoveryResult.techStack as Prisma.InputJsonValue,
        summary: discoveryResult.rawMessage,
      },
    });

    await tx.project.update({
      where: { id: projectId },
      data: { status: ProjectStatus.PENDING, failureReason: null },
    });

    await tx.node.updateMany({
      where: { id: nodeId },
      data: { status: NodeStatus.COMPLETED, finishedAt: new Date() },
    });
    await tx.execution.updateMany({
      where: { id: executionId },
      data: { status: ExecutionStatus.COMPLETED, finishedAt: new Date() },
    });
    await tx.workflow.updateMany({
      where: { id: workflowId },
      data: { status: WorkflowStatus.COMPLETED },
    });

    await tx.runtimeEvent.createMany({
      data: [
        {
          executionId,
          nodeId,
          type: "node.completed",
          payload: { nodeId, artifactId: artifact.id },
        },
        {
          executionId,
          type: "execution.completed",
          payload: { executionId },
        },
        {
          executionId,
          type: "workflow.completed",
          payload: { workflowId },
        },
      ],
    });
  });

  return artifact;
}