import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { CreatePromptSchema } from "@/lib/validations/prompt";
import { NextResponse } from "next/server";
import { inngest } from "@/app/inngest/client";


export async function POST(request: Request) {
    const { user, error } = await requireDbUser();
    if (error) return error;

    let body: unknown;
    try {
        body = await request.json();
    } catch (error) {
        return NextResponse.json({ error: "Invalid Json Format" }, { status: 400 });
    }

    const validationResult = CreatePromptSchema.safeParse(body);
    if (!validationResult.success) {
        return NextResponse.json({ error: validationResult.error.flatten() }, { status: 400 });
    }

    const { projectId, prompt } = validationResult.data;
    const project = await prisma.project.findUnique({
        where: { id: projectId, userId: user.id }
    })
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    try {
        const message = await prisma.message.create({
            data: {
                projectId: projectId,
                role: "USER",
                content: prompt,
            }
        })
        // fire inngest event here
        try {
            await inngest.send({

                name: "chat/requested",
                data: {
                    projectId: projectId,
                    prompt: message.content,
                    messageId: message.id,
                    userId: user.id,
                }

            });
        } catch (error) {
            return NextResponse.json({ error: "Failed to send event to inngest" }, { status: 500 });
        }

        return NextResponse.json({ projectId:projectId, messageId: message.id, message: message.content, status: "processing" });


    } catch (error) {
        return NextResponse.json({ error: "Failed to save message to database" }, { status: 500 });
    }

}