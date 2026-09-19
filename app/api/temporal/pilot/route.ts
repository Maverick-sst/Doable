import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { getTemporalClient } from "@/src/temporal/client";
import { pilotWorkflow } from "@/src/temporal/workflows/pilotWorkflow";

const TEMPORAL_TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "pilot-queue";

const TriggerPilotSchema = z.object({
  projectId: z.string().min(1),
  workflowId: z.string().min(1),
  executionId: z.string().min(1),
  nodeId: z.string().optional(),
  taskId: z.string().optional(),
});

export async function POST(request: Request) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON format" }, { status: 400 });
  }

  const validation = TriggerPilotSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.flatten() },
      { status: 400 },
    );
  }

  const { projectId, workflowId, executionId, nodeId, taskId } =
    validation.data;

  const execution = await prisma.execution.findUnique({
    where: { id: executionId },
    include: {
      workflow: {
        include: {
          project: { select: { id: true, userId: true } },
        },
      },
    },
  });

  if (!execution) {
    return NextResponse.json(
      { error: `Execution ${executionId} not found` },
      { status: 404 },
    );
  }

  if (execution.workflowId !== workflowId) {
    return NextResponse.json(
      { error: `Execution ${executionId} does not belong to workflow ${workflowId}` },
      { status: 403 },
    );
  }

  if (execution.workflow.project.id !== projectId) {
    return NextResponse.json(
      { error: `Workflow ${workflowId} does not belong to project ${projectId}` },
      { status: 403 },
    );
  }

  if (execution.workflow.project.userId !== user.id) {
    return NextResponse.json(
      { error: `Project ${projectId} does not belong to the authenticated user` },
      { status: 403 },
    );
  }

  const temporalWorkflowId = `pilot-${executionId}`;

  console.log("Triggering Temporal pilot workflow", {
    doableProjectId: projectId,
    doableWorkflowId: workflowId,
    doableExecutionId: executionId,
    doableNodeId: nodeId ?? null,
    doableTaskId: taskId ?? null,
    temporalWorkflowId,
  });

  let temporalRunId: string;
  try {
    const client = getTemporalClient();
    const handle = await client.workflow.start(pilotWorkflow, {
      taskQueue: TEMPORAL_TASK_QUEUE,
      workflowId: temporalWorkflowId,
      args: [
        {
          identity: {
            projectId,
            workflowId,
            executionId,
            nodeId: nodeId ?? "",
            userId: user.id,
            taskId,
          },
        },
      ],
    });
    temporalRunId = handle.firstExecutionRunId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Temporal pilot trigger failed:", message);
    return NextResponse.json(
      { error: "Temporal server is unreachable. Please try again later." },
      { status: 503 },
    );
  }

  console.log("Temporal pilot workflow started", {
    temporalWorkflowId,
    temporalRunId,
    doableExecutionId: executionId,
  });

  return NextResponse.json(
    {
      temporalWorkflowId,
      temporalRunId,
      doableExecutionId: executionId,
      status: execution.status,
    },
    { status: 201 },
  );
}
