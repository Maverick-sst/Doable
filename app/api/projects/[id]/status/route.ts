import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  if (!projectId) {
    return NextResponse.json({ error: "Missing project id" }, { status: 400 });
  }

  const { user, error } = await requireDbUser();
  if (error) return error;

  try {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId: user.id,
      },
      select: {
        status: true,
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const latestWorkflow = await prisma.workflow.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        status: true,
        executions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            _count: {
              select: { nodes: true },
            },
          },
        },
      },
    });

    const execution = latestWorkflow?.executions?.[0] ?? null;

    return NextResponse.json({
      status: project.status,
      latestWorkflow: latestWorkflow
        ? {
            id: latestWorkflow.id,
            type: latestWorkflow.type,
            status: latestWorkflow.status,
          }
        : null,
      latestExecution: execution
        ? {
            id: execution.id,
            status: execution.status,
            nodeCount: execution._count.nodes,
          }
        : null,
    });
  } catch (err) {
    console.error("Status endpoint error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
