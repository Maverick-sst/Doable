import { ProjectStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildHcrWorkflowId } from "./contracts/hcr";
import { getTemporalClient, getTemporalTaskQueue } from "./client";
import { hcrWorkflow } from "./workflows/hcrWorkflow";
import { startHcrRun } from "@/src/runtime/workflows/hcr/start-hcr-workflow";
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
export async function startBuild(
  input: StartBuildInput,
): Promise<StartBuildResult> {
  const run = await startHcrRun(input);
  const identity = {
    projectId: run.projectId,
    workflowId: run.workflowId,
    executionId: run.executionId,
    nodeId: run.nodeId,
    userId: input.userId,
  };
  const temporalWorkflowId = buildHcrWorkflowId(identity);

  try {
    const client = getTemporalClient();
    const handle = await client.workflow.start(hcrWorkflow, {
      taskQueue: getTemporalTaskQueue(),
      workflowId: temporalWorkflowId,
      workflowExecutionTimeout: "2 hours",
      args: [
        {
          identity,
          prompt: input.prompt,
          inputArtifactId: input.inputArtifactId ?? null,
        },
      ],
    });

    await prisma.execution.update({
      where: { id: run.executionId },
      data: {
        temporalWorkflowId,
        temporalRunId: handle.firstExecutionRunId,
        startedAt: new Date(),
      },
    });

    return {
      ...run,
      temporalWorkflowId,
      temporalRunId: handle.firstExecutionRunId,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Temporal start failed";
    await failExecution({
      projectId: run.projectId,
      workflowId: run.workflowId,
      executionId: run.executionId,
      nodeId: run.nodeId,
      reason,
      code: "trigger_error",
    });
    throw new BuildStartError(
      "The build worker is unavailable. The project is recoverable; retry when Temporal is running.",
    );
  }
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