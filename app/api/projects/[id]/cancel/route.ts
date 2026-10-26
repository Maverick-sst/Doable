import { NextResponse } from "next/server";
import { ExecutionStatus, WorkflowType } from "@prisma/client";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { cancelBuild } from "@/src/temporal/runtime";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id: projectId } = await params;
  const execution = await prisma.execution.findFirst({
    where: {
      status: { in: [ExecutionStatus.CREATED, ExecutionStatus.RUNNING] },
      workflow: {
        projectId,
        type: WorkflowType.HCR,
        project: { userId: user.id },
      },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, workflowId: true },
  });

  if (!execution) {
    return NextResponse.json(
      { error: "No active build to cancel" },
      { status: 409 },
    );
  }

  const result = await cancelBuild({
    projectId,
    workflowId: execution.workflowId,
    executionId: execution.id,
  });

  return NextResponse.json({ ...result, executionId: execution.id });
}