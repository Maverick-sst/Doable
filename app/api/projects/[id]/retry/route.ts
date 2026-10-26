import { NextResponse } from "next/server";
import { MessagePhase } from "@prisma/client";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import {
  BuildStartError,
  retryOrResumeBuild,
} from "@/src/temporal/runtime";
import {
  BuildNotReadyError,
} from "@/src/runtime/workflows/hcr/start-hcr-workflow";
import {
  ResumeNotAvailableError,
} from "@/src/runtime/workflows/hcr/resume-hcr-run";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id: projectId } = await params;
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id, archivedAt: null },
    select: { id: true, status: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const lastPrompt = await prisma.message.findFirst({
    where: { projectId, phase: MessagePhase.BUILD, role: "USER" },
    orderBy: { createdAt: "desc" },
    select: { content: true },
  });

  if (!lastPrompt) {
    return NextResponse.json(
      { error: "No build prompt exists to retry" },
      { status: 409 },
    );
  }

  try {
    // Resumes from the node the previous attempt stopped at, reusing its
    // artifacts and workspace files. Falls back to a fresh build when there is
    // no resumable position.
    const run = await retryOrResumeBuild({
      projectId,
      userId: user.id,
      prompt: lastPrompt.content,
    });
    return NextResponse.json(
      {
        projectId: run.projectId,
        messageId: run.messageId,
        workflowId: run.workflowId,
        executionId: run.executionId,
        temporalWorkflowId: run.temporalWorkflowId,
        attempt: run.attempt,
        resumed: run.resumed,
        status: "processing",
      },
      { status: 202 },
    );
  } catch (error) {
    if (
      error instanceof BuildNotReadyError ||
      error instanceof ResumeNotAvailableError
    ) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof BuildStartError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json({ error: "Failed to retry build" }, { status: 500 });
  }
}