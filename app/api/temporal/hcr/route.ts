import { NextResponse } from "next/server";
import { z } from "zod";
import { MessagePhase, ProjectStatus } from "@prisma/client";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { startHCRWorkflow } from "@/src/runtime/workflows/hcr/start-hcr-workflow";
import { getTemporalClient } from "@/src/temporal/client";
import { buildHcrWorkflowId } from "@/src/temporal/contracts/hcr";
import { hcrWorkflow } from "@/src/temporal/workflows/hcrWorkflow";

const TEMPORAL_TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "pilot-queue";

// Isolated Temporal HCR trigger (Agent 05 cutover-prep). Additive only:
// POST /chat keeps firing Inngest unchanged. This route mirrors the chat
// gating/row creation exactly, then starts the Temporal hcrWorkflow instead
// of sending `node/execute`. Rollback = stop calling this route.
const TriggerHcrSchema = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(1).max(10000),
  inputArtifactId: z.string().min(1).nullable().optional(),
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

  const validation = TriggerHcrSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.flatten() },
      { status: 400 },
    );
  }

  const { projectId, prompt, inputArtifactId } = validation.data;

  // Same entry gating as POST /chat: only PENDING|IDLE projects start.
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: user.id,
      status: { in: ["PENDING", "IDLE"] },
    },
    select: { id: true },
  });

  if (!project) {
    return NextResponse.json(
      { error: "Project not found or not in a valid state" },
      { status: 404 },
    );
  }

  const message = await prisma.message.create({
    data: {
      projectId,
      role: "USER",
      content: prompt,
      phase: MessagePhase.BUILD,
    },
    select: { id: true, content: true },
  });

  // Same durable chain as the Inngest path: Workflow → Execution → ARCHITECT.
  const { workflowId, executionId, nodeId } = await startHCRWorkflow(
    projectId,
    user.id,
    prompt,
  );

  await prisma.project.update({
    where: { id: projectId },
    data: { status: ProjectStatus.IN_PROGRESS },
  });

  // Deterministic Temporal ID so a repeated trigger for the same execution
  // reattaches instead of forking product state (see contracts/hcr).
  const temporalWorkflowId = buildHcrWorkflowId({
    workflowId,
    executionId,
    nodeId,
    projectId,
    userId: user.id,
  });

  console.log("Triggering Temporal HCR workflow", {
    doableProjectId: projectId,
    doableWorkflowId: workflowId,
    doableExecutionId: executionId,
    doableNodeId: nodeId,
    temporalWorkflowId,
  });

  let temporalRunId: string;
  try {
    const client = getTemporalClient();
    const handle = await client.workflow.start(hcrWorkflow, {
      taskQueue: TEMPORAL_TASK_QUEUE,
      workflowId: temporalWorkflowId,
      args: [
        {
          identity: {
            projectId,
            workflowId,
            executionId,
            nodeId,
            userId: user.id,
          },
          prompt: message.content,
          inputArtifactId: inputArtifactId ?? null,
        },
      ],
    });
    temporalRunId = handle.firstExecutionRunId;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    console.error("Temporal HCR trigger failed:", detail);
    // Rows above remain CREATED/IN_PROGRESS (same orphan caveat as the chat
    // route's Inngest-send failure); see HCR_CUTOVER_RUNBOOK.md for cleanup.
    return NextResponse.json(
      { error: "Temporal server is unreachable. Please try again later." },
      { status: 503 },
    );
  }

  console.log("Temporal HCR workflow started", {
    temporalWorkflowId,
    temporalRunId,
    doableExecutionId: executionId,
  });

  return NextResponse.json(
    {
      temporalWorkflowId,
      temporalRunId,
      doableWorkflowId: workflowId,
      doableExecutionId: executionId,
      doableNodeId: nodeId,
      messageId: message.id,
      status: "started",
    },
    { status: 201 },
  );
}
