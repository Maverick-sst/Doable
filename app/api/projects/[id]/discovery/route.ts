import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ExecutionStatus,
  MessagePhase,
  NodeStatus,
  ProjectStatus,
  WorkflowStatus,
} from "@prisma/client";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { callDiscoveryAgent } from "@/src/cognition/discovery-agent";
import { startDiscoveryWorkflow } from "@/src/runtime/workflows/discovery/start-discovery-workflow";
import { completeDiscoveryWorkflow } from "@/src/runtime/workflows/discovery/complete-discovery-workflow";
import { startMemoryCurationWorkflow } from "@/src/temporal/memory-client";

const DiscoveryRequestSchema = z.object({
  prompt: z.string().min(1).max(10_000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id: projectId } = await params;
  if (!projectId) {
    return NextResponse.json({ error: "Missing project id" }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: user.id,
      status: ProjectStatus.DISCOVERY,
      archivedAt: null,
    },
    include: { memory: true },
  });

  if (!project || !project.memory) {
    return NextResponse.json(
      {
        error:
          "Project not found, archived, or no longer in the discovery phase",
      },
      { status: 404 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON format" }, { status: 400 });
  }

  const parsed = DiscoveryRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "prompt is required", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Read history before persisting the new turn so the current prompt is
  // not sent to the model twice.
  const history = await prisma.message.findMany({
    where: { projectId, phase: MessagePhase.DISCOVERY },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  await prisma.message.create({
    data: {
      projectId,
      role: "USER",
      content: parsed.data.prompt,
      phase: MessagePhase.DISCOVERY,
    },
  });

  let agentResponse;
  try {
    agentResponse = await callDiscoveryAgent(
      project.memory.domain,
      parsed.data.prompt,
      history,
    );
  } catch (error) {
    console.error("Discovery provider failure:", {
      projectId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "The discovery model is unavailable. Your message was saved." },
      { status: 502 },
    );
  }

  const { workflowId, executionId, nodeId } = await startDiscoveryWorkflow(
    projectId,
  );

  await prisma.message.create({
    data: {
      projectId,
      role: "ASSISTANT",
      content: agentResponse.message,
      phase: MessagePhase.DISCOVERY,
      workflowId,
      executionId,
    },
  });

  if (!agentResponse.discoveryComplete) {
    await prisma.node.updateMany({
      where: { id: nodeId },
      data: { status: NodeStatus.COMPLETED, finishedAt: new Date() },
    });
    await prisma.execution.updateMany({
      where: { id: executionId },
      data: { status: ExecutionStatus.COMPLETED, finishedAt: new Date() },
    });
    await prisma.workflow.updateMany({
      where: { id: workflowId },
      data: { status: WorkflowStatus.COMPLETED },
    });

    return NextResponse.json({
      message: agentResponse.message,
      discoveryComplete: false,
    });
  }

  try {
    const artifact = await completeDiscoveryWorkflow({
      projectId,
      workflowId,
      executionId,
      nodeId,
      discoveryResult: {
        domain: project.memory.domain,
        requirements: agentResponse.requirements ?? {},
        techStack: agentResponse.techStack ?? {},
        rawMessage: agentResponse.message,
      },
    });

    // Memory curation is best-effort: a discovery turn must never fail
    // because background maintenance is unavailable.
    try {
      await startMemoryCurationWorkflow({
        projectId,
        userId: user.id,
        trigger: "discovery",
        executionId,
      });
    } catch (error) {
      console.warn("Memory curation start failed after discovery:", {
        projectId,
        message: error instanceof Error ? error.message : "unknown",
      });
    }

    return NextResponse.json({
      message: agentResponse.message,
      discoveryComplete: true,
      artifactId: artifact.id,
    });
  } catch (error) {
    console.error("Discovery completion failure:", {
      projectId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      {
        error:
          "Discovery completed but the requirements could not be persisted. Please retry.",
      },
      { status: 500 },
    );
  }
}