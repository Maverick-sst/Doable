import {
  ArtifactType,
  MessagePhase,
  NodeStatus,
  NodeType,
  ProjectStatus,
  WorkflowType,
  WorkflowStatus,
  ExecutionStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

export class BuildNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildNotReadyError";
  }
}

export interface StartHcrRunInput {
  projectId: string;
  userId: string;
  prompt: string;
}

export interface StartHcrRunResult {
  projectId: string;
  messageId: string;
  workflowId: string;
  executionId: string;
  nodeId: string;
}

/**
 * Durable product-state creation for one build attempt.
 *
 * The conditional project update is the one-active-build lock: two concurrent
 * requests cannot both move PENDING/IDLE to IN_PROGRESS. Message, workflow,
 * execution, node, and creation events commit atomically.
 */
export async function startHcrRun(
  input: StartHcrRunInput,
): Promise<StartHcrRunResult> {
  const discovery = await prisma.artifact.findFirst({
    where: { projectId: input.projectId, type: ArtifactType.DISCOVERY_REQUIREMENT },
    orderBy: { version: "desc" },
    select: { id: true },
  });

  if (!discovery) {
    throw new BuildNotReadyError(
      "No approved discovery requirements exist for this project",
    );
  }

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.updateMany({
      where: {
        id: input.projectId,
        userId: input.userId,
        archivedAt: null,
        status: { in: [ProjectStatus.PENDING, ProjectStatus.IDLE] },
      },
      data: { status: ProjectStatus.IN_PROGRESS, failureReason: null },
    });

    if (project.count === 0) {
      throw new BuildNotReadyError(
        "Project is not ready to build or another build is already active",
      );
    }

    const workflow = await tx.workflow.create({
      data: {
        projectId: input.projectId,
        type: WorkflowType.HCR,
        status: WorkflowStatus.CREATED,
      },
    });

    const execution = await tx.execution.create({
      data: {
        workflowId: workflow.id,
        status: ExecutionStatus.CREATED,
      },
    });

    const node = await tx.node.create({
      data: {
        executionId: execution.id,
        type: NodeType.ARCHITECT,
        status: NodeStatus.CREATED,
        order: 1,
      },
    });

    const message = await tx.message.create({
      data: {
        projectId: input.projectId,
        role: "USER",
        content: input.prompt,
        phase: MessagePhase.BUILD,
        workflowId: workflow.id,
        executionId: execution.id,
      },
    });

    await tx.runtimeEvent.createMany({
      data: [
        {
          executionId: execution.id,
          type: "workflow.created",
          payload: { workflowId: workflow.id },
        },
        {
          executionId: execution.id,
          type: "execution.created",
          payload: { executionId: execution.id },
        },
        {
          executionId: execution.id,
          nodeId: node.id,
          type: "node.created",
          payload: { nodeId: node.id, type: NodeType.ARCHITECT, order: 1 },
        },
      ],
    });

    return {
      projectId: input.projectId,
      messageId: message.id,
      workflowId: workflow.id,
      executionId: execution.id,
      nodeId: node.id,
    };
  });
}