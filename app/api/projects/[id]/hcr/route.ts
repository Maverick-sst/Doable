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
      select: { id: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Fetch the latest HCR workflow
    const latestWorkflow = await prisma.workflow.findFirst({
      where: { projectId, type: "HCR" },
      orderBy: { createdAt: "desc" },
      include: {
        executions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            nodes: {
              orderBy: { order: "asc" },
            },
            artifacts: {
              orderBy: { createdAt: "asc" },
            },
            events: {
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });

    if (!latestWorkflow || latestWorkflow.executions.length === 0) {
      return NextResponse.json({
        workflow: null,
        execution: null,
        nodes: [],
        artifacts: [],
        events: [],
      });
    }

    const latestExecution = latestWorkflow.executions[0];

    return NextResponse.json({
      workflow: {
        id: latestWorkflow.id,
        type: latestWorkflow.type,
        status: latestWorkflow.status,
      },
      execution: {
        id: latestExecution.id,
        status: latestExecution.status,
        createdAt: latestExecution.createdAt,
      },
      nodes: latestExecution.nodes,
      artifacts: latestExecution.artifacts,
      events: latestExecution.events,
    });
  } catch (err) {
    console.error("HCR Inspection endpoint error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
