import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import {
  BuildStartError,
  startBuild,
} from "@/src/temporal/runtime";
import { BuildNotReadyError } from "@/src/runtime/workflows/hcr/start-hcr-workflow";

const ChatRequestSchema = z.object({
  prompt: z.string().min(1).max(10_000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const projectId = (await params).id;
  if (!projectId) {
    return NextResponse.json({ error: "Missing project id" }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: user.id,
      archivedAt: null,
    },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON format" }, { status: 400 });
  }

  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "prompt is required", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const run = await startBuild({
      projectId,
      userId: user.id,
      prompt: parsed.data.prompt,
    });

    return NextResponse.json(
      {
        projectId: run.projectId,
        messageId: run.messageId,
        workflowId: run.workflowId,
        executionId: run.executionId,
        temporalWorkflowId: run.temporalWorkflowId,
        status: "processing",
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof BuildNotReadyError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof BuildStartError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("Build start failure:", {
      projectId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Failed to initialize the build" },
      { status: 500 },
    );
  }
}