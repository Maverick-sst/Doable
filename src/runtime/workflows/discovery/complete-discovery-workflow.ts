import { prisma } from "@/lib/prisma";
import { Prisma, WorkflowStatus, ExecutionStatus, NodeStatus, NodeType, ProjectStatus, ArtifactType } from "@prisma/client";
import { createArtifact } from "@/src/runtime/artifacts/create-artifact";

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

  // 1. Create the DISCOVERY_REQUIREMENT artifact — this is the durable output
  const artifact = await createArtifact({
    projectId,
    workflowId,
    executionId,
    nodeId,
    type: ArtifactType.DISCOVERY_REQUIREMENT,
    producedBy: NodeType.DISCOVERY,
    content: {
      projectIntent: {
        summary: discoveryResult.rawMessage,
        domain: discoveryResult.domain,
        projectType: discoveryResult.domain === "LANDING_PAGE" ? "Landing Page" : "Full Stack App",
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
    },
  });

  // 2. Update ProjectMemory to point to this artifact metadata
  await prisma.projectMemory.update({
    where: { projectId },
    data: {
      requirements: discoveryResult.requirements as Prisma.InputJsonValue,
      techStack: discoveryResult.techStack as Prisma.InputJsonValue,
      summary: discoveryResult.rawMessage,
    },
  });

  // 3. Flip project status to PENDING (ready for HCR)
  await prisma.project.update({
    where: { id: projectId },
    data: { status: ProjectStatus.PENDING },
  });

  // 4. Close out workflow/execution/node
  await prisma.node.update({ where: { id: nodeId }, data: { status: NodeStatus.COMPLETED } });
  await prisma.execution.update({ where: { id: executionId }, data: { status: ExecutionStatus.COMPLETED } });
  await prisma.workflow.update({ where: { id: workflowId }, data: { status: WorkflowStatus.COMPLETED } });

  // 5. Emit completion events
  await prisma.runtimeEvent.createMany({
    data: [
      { executionId, nodeId, type: "node.completed", payload: { nodeId, artifactId: artifact.id } },
      { executionId, type: "execution.completed", payload: { executionId } },
      { executionId, type: "workflow.completed", payload: { workflowId } },
    ],
  });

  return artifact;
}
