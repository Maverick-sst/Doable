import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { inngest } from "@/app/inngest/client";
import { Starter } from "@/lib/workflow-coordinator";


export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, error } = await requireDbUser();
    if (error) return error;

    const projectId = (await params).id;
    const project = await prisma.project.findUnique({
        where: { id: projectId, userId: user.id, status: { in: ['PENDING', 'IDLE'] } }
    })
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })
    let body: { prompt: string };
    try {
        body = await request.json();
    } catch (error) {
        return NextResponse.json({ error: "Invalid Json Format" }, { status: 400 });
    }
    const { prompt } = body;
    try {
        const message = await prisma.message.create({
            data: {
                projectId: projectId,
                role: "USER",
                content: prompt,
            }
        })

        const { workflowId, executionId, nodeId } = await Starter(projectId, user.id, prompt);
        // fire inngest event here
        try {
            await inngest.send({

                name: "chat/requested",
                data: {
                    projectId: projectId,
                    prompt: message.content,
                    messageId: message.id,
                    userId: user.id,
                    workflowId: workflowId,
                    executionId: executionId,
                    nodeId: nodeId
                }

            });
        } catch (error) {
            return NextResponse.json({ error: "Failed to send event to inngest" }, { status: 500 });
        }

        return NextResponse.json({ projectId: projectId, messageId: message.id, message: message.content, status: "processing" });


    } catch (error) {
        return NextResponse.json({ error: "Failed to save message to database" }, { status: 500 });
    }

}