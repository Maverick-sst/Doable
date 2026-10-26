import {
  ExecutionStatus,
  MessagePhase,
  NodeStatus,
  NodeType,
  ProjectStatus,
  WorkflowStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AGENT_REGISTRY } from "@/src/cognition/agent-registry";

export class ResumeNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeNotAvailableError";
  }
}

export interface ResumeTarget {
  /** The attempt that failed or stopped incomplete. */
  previousExecutionId: string;
  /** The build this attempt belongs to. */
  workflowId: string;
  /** Attempt number of the failed attempt; the resume becomes attempt + 1. */
  attempt: number;
  /** Node type to resume at. */
  nodeType: NodeType;
  /** Global graph order of the resumed node. */
  order: number;
  /** Artifact the resumed node consumes, resolved server-side. */
  inputArtifactId: string | null;
}

export interface ResumeHcrRunInput {
  projectId: string;
  userId: string;
  /** The original user prompt, stored as a message for the record. */
  prompt: string;
  /** The prompt the resumed node actually works from. */
  resumePrompt: string;
  target: ResumeTarget;
}

export interface ResumeHcrRunResult {
  projectId: string;
  messageId: string;
  workflowId: string;
  executionId: string;
  nodeId: string;
  attempt: number;
  inputArtifactId: string | null;
}

/**
 * Find the node a failed or partial attempt should resume from.
 *
 * The target is the highest-order node that is FAILED (hard error) or
 * INCOMPLETE (stopped on budget). Everything before it already produced its
 * artifact, and everything after it has not run, so the graph continues from
 * exactly one position.
 */
export async function findResumeTarget(
  projectId: string,
): Promise<ResumeTarget | null> {
  const execution = await prisma.execution.findFirst({
    where: {
      status: { in: [ExecutionStatus.FAILED, ExecutionStatus.PARTIAL] },
      workflow: { projectId, type: "HCR" },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      workflowId: true,
      attempt: true,
      nodes: {
        where: {
          status: { in: [NodeStatus.FAILED, NodeStatus.INCOMPLETE] },
        },
        orderBy: { order: "desc" },
        select: { type: true, order: true },
      },
    },
  });

  if (!execution) return null;

  const node = execution.nodes[0];
  if (!node) return null;

  const inputArtifactId = await resolveConsumedArtifactId(
    projectId,
    node.type,
  );

  return {
    previousExecutionId: execution.id,
    workflowId: execution.workflowId,
    attempt: execution.attempt,
    nodeType: node.type,
    order: node.order,
    inputArtifactId,
  };
}

/**
 * Resolve the artifact a node consumes, from the registry policy. The client
 * never supplies an artifact id for a build.
 */
async function resolveConsumedArtifactId(
  projectId: string,
  nodeType: NodeType,
): Promise<string | null> {
  const config = AGENT_REGISTRY[nodeType];
  const consumedType = config?.consumedArtifactTypes?.[0];
  if (!consumedType) return null;

  const artifact = await prisma.artifact.findFirst({
    where: { projectId, type: consumedType },
    orderBy: { version: "desc" },
    select: { id: true },
  });
  return artifact?.id ?? null;
}

/**
 * Compose the prompt the resumed node works from.
 *
 * The node must know it is continuing, otherwise it re-derives work that is
 * already in the workspace. The original user prompt is still recorded as a
 * message, so the conversation history stays truthful.
 */
export function composeResumePrompt(input: {
  originalPrompt: string;
  attempt: number;
  nodeType: NodeType;
  existingFiles: string[];
}): string {
  const files = input.existingFiles.length
    ? input.existingFiles.map((path) => `- ${path}`).join("\n")
    : "- (none yet)";

  return `${input.originalPrompt}

## Resume context

This is attempt ${input.attempt} of this build. The previous attempt stopped
at ${input.nodeType}. Work already present in the workspace is listed below.

Continue from the existing files. Read a file before editing it, prefer
\`edit_file\` over \`create_file\` for files that already exist, and only call
\`mark_complete\` when every assigned task is genuinely finished.

Existing files:
${files}`;
}

/**
 * Create the resumed attempt.
 *
 * A build is one Workflow; an attempt is one Execution under it. The resume
 * reuses the build's workflow, creates a new attempt with the incremented
 * attempt number and a link to the attempt it continues, and creates the
 * first node of that attempt at the resume position.
 *
 * The workflow code does not need to know about resumes: it starts from the
 * node row this function creates, so the database stays the source of truth
 * for the starting position.
 */
export async function resumeHcrRun(
  input: ResumeHcrRunInput,
): Promise<ResumeHcrRunResult> {
  const { target } = input;

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.updateMany({
      where: {
        id: input.projectId,
        userId: input.userId,
        archivedAt: null,
        status: {
          in: [
            ProjectStatus.FAILED,
            ProjectStatus.INCOMPLETE,
            ProjectStatus.IDLE,
            ProjectStatus.PENDING,
          ],
        },
      },
      data: { status: ProjectStatus.IN_PROGRESS, failureReason: null },
    });

    if (project.count === 0) {
      throw new ResumeNotAvailableError(
        "Project is not resumable or another build is already active",
      );
    }

    await tx.workflow.updateMany({
      where: { id: target.workflowId },
      data: { status: WorkflowStatus.CREATED },
    });

    const execution = await tx.execution.create({
      data: {
        workflowId: target.workflowId,
        status: ExecutionStatus.CREATED,
        attempt: target.attempt + 1,
        parentExecutionId: target.previousExecutionId,
        resumedFromNodeType: target.nodeType,
        completionStatus: "COMPLETE",
      },
    });

    const node = await tx.node.create({
      data: {
        executionId: execution.id,
        type: target.nodeType,
        status: NodeStatus.CREATED,
        order: target.order,
      },
    });

    const message = await tx.message.create({
      data: {
        projectId: input.projectId,
        role: "USER",
        content: input.prompt,
        phase: MessagePhase.BUILD,
        workflowId: target.workflowId,
        executionId: execution.id,
      },
    });

    await tx.runtimeEvent.createMany({
      data: [
        {
          executionId: execution.id,
          type: "execution.created",
          payload: {
            executionId: execution.id,
            attempt: target.attempt + 1,
            resumedFrom: target.previousExecutionId,
            resumedFromNodeType: target.nodeType,
          },
        },
        {
          executionId: execution.id,
          nodeId: node.id,
          type: "node.created",
          payload: {
            nodeId: node.id,
            type: target.nodeType,
            order: target.order,
            resumed: true,
          },
        },
      ],
    });

    return {
      projectId: input.projectId,
      messageId: message.id,
      workflowId: target.workflowId,
      executionId: execution.id,
      nodeId: node.id,
      attempt: target.attempt + 1,
      inputArtifactId: target.inputArtifactId,
    };
  });
}
