import { ProjectStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildHcrWorkflowId } from "./contracts/hcr";
import { getTemporalClient, getTemporalTaskQueue } from "./client";
import { hcrWorkflow } from "./workflows/hcrWorkflow";
import { startHcrRun } from "@/src/runtime/workflows/hcr/start-hcr-workflow";
import {
  composeResumePrompt,
  findResumeTarget,
  resumeHcrRun,
  type ResumeTarget,
} from "@/src/runtime/workflows/hcr/resume-hcr-run";
import { listWorkspaceFiles } from "@/src/runtime/workspace";
import { HCR_WORKFLOW_TIMEOUT } from "@/src/runtime/budgets";
import {
  cancelExecution,
  failExecution,
} from "@/src/runtime/state/transitions";

export class BuildStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildStartError";
  }
}

export interface StartBuildInput {
  projectId: string;
  userId: string;
  prompt: string;
  inputArtifactId?: string | null;
}

export interface StartBuildResult {
  projectId: string;
  messageId: string;
  workflowId: string;
  executionId: string;
  nodeId: string;
  temporalWorkflowId: string;
  temporalRunId: string;
}

/**
 * The single build-start seam. Routes never create orchestration rows or
 * start Temporal themselves; they call this and map the error.
 */
async function startTemporalAttempt(input: {
  projectId: string;
  userId: string;
  workflowId: string;
  executionId: string;
  nodeId: string;
  /** The prompt the node works from. */
  prompt: string;
  inputArtifactId: string | null;
}): Promise<{ temporalWorkflowId: string; temporalRunId: string }> {
  const identity = {
    projectId: input.projectId,
    workflowId: input.workflowId,
    executionId: input.executionId,
    nodeId: input.nodeId,
    userId: input.userId,
  };
  const temporalWorkflowId = buildHcrWorkflowId(identity);

  try {
    const client = getTemporalClient();
    const handle = await client.workflow.start(hcrWorkflow, {
      taskQueue: getTemporalTaskQueue(),
      workflowId: temporalWorkflowId,
      workflowExecutionTimeout: HCR_WORKFLOW_TIMEOUT,
      args: [
        {
          identity,
          prompt: input.prompt,
          inputArtifactId: input.inputArtifactId,
        },
      ],
    });

    await prisma.execution.update({
      where: { id: input.executionId },
      data: {
        temporalWorkflowId,
        temporalRunId: handle.firstExecutionRunId,
        startedAt: new Date(),
      },
    });

    return {
      temporalWorkflowId,
      temporalRunId: handle.firstExecutionRunId,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Temporal start failed";
    await failExecution({
      projectId: input.projectId,
      workflowId: input.workflowId,
      executionId: input.executionId,
      nodeId: input.nodeId,
      reason,
      code: "trigger_error",
    });
    throw new BuildStartError(
      "The build worker is unavailable. The project is recoverable; retry when Temporal is running.",
    );
  }
}

export async function startBuild(
  input: StartBuildInput,
): Promise<StartBuildResult> {
  const run = await startHcrRun(input);
  const started = await startTemporalAttempt({
    projectId: run.projectId,
    userId: input.userId,
    workflowId: run.workflowId,
    executionId: run.executionId,
    nodeId: run.nodeId,
    prompt: input.prompt,
    inputArtifactId: input.inputArtifactId ?? null,
  });

  return { ...run, ...started };
}

export interface ResumeBuildInput {
  projectId: string;
  userId: string;
  /** The original user prompt, kept in the message record. */
  prompt: string;
  target: ResumeTarget;
}

export interface ResumeBuildResult extends StartBuildResult {
  attempt: number;
}

/**
 * Resume a failed or partial attempt from the node it stopped at.
 *
 * Artifacts and workspace files from the previous attempt are reused, so the
 * resumed node continues instead of re-deriving the whole build.
 */
export async function resumeBuild(
  input: ResumeBuildInput,
): Promise<ResumeBuildResult> {
  const existingFiles = await listWorkspaceFiles(input.projectId);
  const resumePrompt = composeResumePrompt({
    originalPrompt: input.prompt,
    attempt: input.target.attempt + 1,
    nodeType: input.target.nodeType,
    existingFiles,
  });

  const run = await resumeHcrRun({
    projectId: input.projectId,
    userId: input.userId,
    prompt: input.prompt,
    resumePrompt,
    target: input.target,
  });

  const started = await startTemporalAttempt({
    projectId: run.projectId,
    userId: input.userId,
    workflowId: run.workflowId,
    executionId: run.executionId,
    nodeId: run.nodeId,
    prompt: resumePrompt,
    inputArtifactId: run.inputArtifactId,
  });

  return { ...run, ...started };
}

/**
 * Choose between resuming and starting fresh.
 *
 * A previous attempt that stopped at a node resumes from that node. Anything
 * else starts a new build.
 */
export async function retryOrResumeBuild(
  input: StartBuildInput,
): Promise<StartBuildResult & { resumed: boolean; attempt: number }> {
  const target = await findResumeTarget(input.projectId);
  if (!target) {
    const started = await startBuild(input);
    return { ...started, resumed: false, attempt: 1 };
  }

  const resumed = await resumeBuild({ ...input, target });
  return { ...resumed, resumed: true, attempt: resumed.attempt };
}

export async function cancelBuild(input: {
  projectId: string;
  workflowId: string;
  executionId: string;
}): Promise<{ dbCancelled: boolean; temporalCancelled: boolean }> {
  const temporalWorkflowId = `hcr-${input.executionId}`;
  let temporalCancelled = false;

  try {
    const client = getTemporalClient();
    const handle = client.workflow.getHandle(temporalWorkflowId);
    await handle.cancel();
    temporalCancelled = true;
  } catch {
    // A missing/closed workflow is not a failure to cancel product state.
  }

  const result = await cancelExecution({
    projectId: input.projectId,
    workflowId: input.workflowId,
    executionId: input.executionId,
  });

  return { dbCancelled: result.transitioned, temporalCancelled };
}

export async function retryBuild(input: StartBuildInput): Promise<StartBuildResult> {
  await prisma.project.updateMany({
    where: {
      id: input.projectId,
      userId: input.userId,
      status: { in: [ProjectStatus.FAILED, ProjectStatus.IDLE] },
    },
    data: { status: ProjectStatus.PENDING, failureReason: null },
  });
  return startBuild(input);
}

export function temporalHandle(executionId: string) {
  return getTemporalClient().workflow.getHandle(`hcr-${executionId}`);
}