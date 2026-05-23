import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { inngest } from "@/app/inngest/client";
import { startHCRWorkflow } from "@/src/runtime/workflows/hcr/start-hcr-workflow";
import { MessagePhase, ProjectStatus } from "@prisma/client";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, error } = await requireDbUser();
    if (error) return error;

    const projectId = (await params).id;
    if (!projectId) {
        return NextResponse.json({ error: "Missing project id" }, { status: 400 });
    }

    const project = await prisma.project.findFirst({
        where: { id: projectId, userId: user.id, status: { in: ['PENDING', 'IDLE'] } }
    });
    if (!project) {
        return NextResponse.json({ error: "Project not found or not in a valid state" }, { status: 404 });
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

    try {
        // Create the message in BUILD phase
        const message = await prisma.message.create({
            data: {
                projectId,
                role: "USER",
                content: prompt,
                phase: MessagePhase.BUILD,
            }
        });

        // Initialize the HCR workflow tracking state
        const { workflowId, executionId, nodeId } = await startHCRWorkflow(projectId, user.id, prompt);

        // Update project status to IN_PROGRESS
        await prisma.project.update({
            where: { id: projectId },
            data: { status: ProjectStatus.IN_PROGRESS }
        });

        // Fire the inngest event to trigger background HCR execution
        try {
            await inngest.send({
                name: "chat/requested",
                data: {
                    projectId,
                    prompt: message.content,
                    messageId: message.id,
                    userId: user.id,
                    workflowId,
                    executionId,
                    nodeId
                }
            });
        } catch (err) {
            console.error("Inngest send error:", err);
            return NextResponse.json({ error: "Failed to start workflow worker" }, { status: 500 });
        }

        return NextResponse.json({
            projectId,
            messageId: message.id,
            message: message.content,
            status: "processing"
        });

    } catch (err) {
        console.error("Chat handler error:", err);
        return NextResponse.json({ error: "Failed to initialize chat runtime" }, { status: 500 });
    }
}