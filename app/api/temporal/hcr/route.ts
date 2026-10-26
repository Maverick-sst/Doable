import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import {
  BuildStartError,
  startBuild,
} from "@/src/temporal/runtime";
import { BuildNotReadyError } from "@/src/runtime/workflows/hcr/start-hcr-workflow";

const TriggerHcrSchema = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(1).max(10_000),
  inputArtifactId: z.string().min(1).nullable().optional(),
});

/**
 * Explicit Temporal trigger retained for diagnostics and the test harness.
 * It shares the same product-state seam as POST /chat.
 */
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

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id, archivedAt: null },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const run = await startBuild({
      projectId,
      userId: user.id,
      prompt,
      inputArtifactId: inputArtifactId ?? null,
    });

    return NextResponse.json(
      {
        temporalWorkflowId: run.temporalWorkflowId,
        temporalRunId: run.temporalRunId,
        doableWorkflowId: run.workflowId,
        doableExecutionId: run.executionId,
        doableNodeId: run.nodeId,
        messageId: run.messageId,
        status: "started",
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof BuildNotReadyError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof BuildStartError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: "Failed to start the Temporal build" },
      { status: 500 },
    );
  }
}