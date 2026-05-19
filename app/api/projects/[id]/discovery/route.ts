import { requireDbUser } from "@/lib/auth-user";
import { callDiscoveryAgent } from "@/lib/discovery-agent";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

// qA loop + populate ProjectMemory + flip projectStatus
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, error } = await requireDbUser();
    if (error) return error;
    const projectId = (await params).id;
    let body: { domain: string, prompt: string };
    try {
        body = await request.json();
    } catch (error) {
        return NextResponse.json({ error: "Invalid Json Format" }, { status: 400 });
    }

    const { domain, prompt } = body;
    // fetch history for current conversation with discovery agent
    const history: { role: string, content: string }[] = await prisma.message.findMany({
        where: {
            projectId: projectId
        },
        select: {
            role: true,
            content: true
        }
    })

    await prisma.message.create({
        data: {
            projectId: projectId,
            role: "USER",
            content: prompt
        }
    })

    const response = await callDiscoveryAgent(domain, prompt, history);

    const { discoveryComplete, requirements, techStack } = response.message.content;

    if (discoveryComplete) {
        await prisma.projectMemory.update({
            where: {
                projectId: projectId
            },
            data: {
                requirements: requirements,
                techStack: techStack
            }
        });

        await prisma.project.update({
            where: {
                id: projectId
            },
            data: {
                status: "PENDING"
            }
        })
    }

    return {message: response.message.content ,discoveryComplete};




}