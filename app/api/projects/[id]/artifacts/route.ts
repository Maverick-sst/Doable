import { NextResponse } from "next/server";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id: projectId } = await params;
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const artifacts = await prisma.artifact.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      type: true,
      version: true,
      schemaVersion: true,
      validationStatus: true,
      contentHash: true,
      producedBy: true,
      content: true,
      metadata: true,
      workflowId: true,
      executionId: true,
      nodeId: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ artifacts });
}