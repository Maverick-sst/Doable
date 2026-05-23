import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { callDiscoveryAgent } from "@/src/cognition/discovery-agent";
import { startDiscoveryWorkflow } from "@/src/runtime/workflows/discovery/start-discovery-workflow";
import { completeDiscoveryWorkflow } from "@/src/runtime/workflows/discovery/complete-discovery-workflow";
import { MessagePhase, NodeStatus, ExecutionStatus, WorkflowStatus } from "@prisma/client";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id: projectId } = await params;
  if (!projectId) {
    return NextResponse.json({ error: "Missing project id" }, { status: 400 });
  }

  // Find project and its memory scoped to user
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: user.id,
    },
    include: {
      memory: true,
    },
  });

  if (!project || !project.memory) {
    return NextResponse.json({ error: "Project or project memory not found" }, { status: 404 });
  }

  let body: { prompt: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON format" }, { status: 400 });
  }

  const { prompt } = body;
  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  // Fetch recent DISCOVERY messages
  const history = await prisma.message.findMany({
    where: {
      projectId,
      phase: MessagePhase.DISCOVERY,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      role: true,
      content: true,
    },
  });

  // Call discovery agent
  const agentResponse = await callDiscoveryAgent(
    project.memory.domain,
    prompt,
    history
  );

  // Start Discovery workflow state tracking (for analytics/events)
  const { workflowId, executionId, nodeId } = await startDiscoveryWorkflow(projectId);

  // Save user message
  await prisma.message.create({
    data: {
      projectId,
      role: "USER",
      content: prompt,
      phase: MessagePhase.DISCOVERY,
    },
  });

  let artifactId: string | undefined;

  if (agentResponse.discoveryComplete) {
    // Complete discovery workflow & save artifact + flip status
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

    artifactId = artifact.id;

    // Save agent message
    await prisma.message.create({
      data: {
        projectId,
        role: "ASSISTANT",
        content: agentResponse.message,
        phase: MessagePhase.DISCOVERY,
      },
    });

    return NextResponse.json({
      message: agentResponse.message,
      discoveryComplete: true,
      artifactId,
    });
  } else {
    // Discovery is not complete yet — keep going
    // Mark discovery workflow nodes as completed for this turn
    await prisma.node.update({ where: { id: nodeId }, data: { status: NodeStatus.COMPLETED } });
    await prisma.execution.update({ where: { id: executionId }, data: { status: ExecutionStatus.COMPLETED } });
    await prisma.workflow.update({ where: { id: workflowId }, data: { status: WorkflowStatus.COMPLETED } });

    // Save agent message
    await prisma.message.create({
      data: {
        projectId,
        role: "ASSISTANT",
        content: agentResponse.message,
        phase: MessagePhase.DISCOVERY,
      },
    });

    return NextResponse.json({
      message: agentResponse.message,
      discoveryComplete: false,
    });
  }
}