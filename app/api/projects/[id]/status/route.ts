import { NextResponse } from "next/server";
import { WorkflowType } from "@prisma/client";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  if (!projectId) {
    return NextResponse.json({ error: "Missing project id" }, { status: 400 });
  }

  const { user, error } = await requireDbUser();
  if (error) return error;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id },
    select: {
      status: true,
      failureReason: true,
      updatedAt: true,
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const [latestBuild, latestDiscovery] = await Promise.all([
    prisma.workflow.findFirst({
      where: { projectId, type: WorkflowType.HCR },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        status: true,
        createdAt: true,
        executions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            failureReason: true,
            temporalWorkflowId: true,
            startedAt: true,
            finishedAt: true,
            nodes: {
              orderBy: { order: "asc" },
              select: {
                id: true,
                type: true,
                status: true,
                order: true,
                attempt: true,
                startedAt: true,
                finishedAt: true,
                failureReason: true,
              },
            },
            _count: { select: { nodes: true, artifacts: true } },
          },
        },
      },
    }),
    prisma.workflow.findFirst({
      where: { projectId, type: WorkflowType.DISCOVERY },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        createdAt: true,
        executions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true },
        },
      },
    }),
  ]);

  const buildExecution = latestBuild?.executions[0] ?? null;
  const discoveryExecution = latestDiscovery?.executions[0] ?? null;

  return NextResponse.json({
    status: project.status,
    failureReason: project.failureReason,
    updatedAt: project.updatedAt,
    latestWorkflow: latestBuild
      ? {
          id: latestBuild.id,
          type: latestBuild.type,
          status: latestBuild.status,
        }
      : null,
    latestExecution: buildExecution
      ? {
          id: buildExecution.id,
          status: buildExecution.status,
          nodeCount: buildExecution._count.nodes,
        }
      : null,
    build: latestBuild
      ? {
          workflowId: latestBuild.id,
          status: latestBuild.status,
          createdAt: latestBuild.createdAt,
          execution: buildExecution
            ? {
                id: buildExecution.id,
                status: buildExecution.status,
                failureReason: buildExecution.failureReason,
                temporalWorkflowId: buildExecution.temporalWorkflowId,
                startedAt: buildExecution.startedAt,
                finishedAt: buildExecution.finishedAt,
                artifactCount: buildExecution._count.artifacts,
                nodes: buildExecution.nodes,
              }
            : null,
        }
      : null,
    discovery: latestDiscovery
      ? {
          workflowId: latestDiscovery.id,
          status: latestDiscovery.status,
          createdAt: latestDiscovery.createdAt,
          execution: discoveryExecution,
        }
      : null,
  });
}