import { prisma } from "@/lib/prisma";
import { CreateProjectSchema } from "@/lib/validations/project";
import { NextResponse } from "next/server";
import { requireDbUser } from "@/lib/auth-user";
import { Prisma } from "@prisma/client";

export async function POST(request: Request) {
    const { user, error } = await requireDbUser();
    if (error) return error;

    let body: unknown;
    try {
        body = await request.json();
    } catch (error) {
        return NextResponse.json({ error: "Invalid Json Format" }, { status: 400 });
    }

    const validationResult = CreateProjectSchema.safeParse(body);
    if (!validationResult.success) {
        return new Response(JSON.stringify(validationResult.error), { status: 400 });
    }
    const { name, description, domain, techStack, requirements } = validationResult.data;


    try {

        let project = { id: "", name: name, description: description || null };
        await prisma.$transaction(async (tx) => {
            project = await tx.project.create({
                data: {
                    name,
                    description,
                    userId: user.id
                },
                select: {
                    id: true,
                    name: true,
                    description: true
                }
            })
            await tx.projectMemory.create({
                data: {
                    projectId: project.id,
                    domain: domain,
                    techStack: techStack,
                    requirements: requirements,
                    summary: ""
                }
            })
            return project;
        })
        return NextResponse.json({
            projectId: project.id,
            name: project.name,
            description: project.description,
            message: "Project created successfully",
        }, { status: 201 });

    } catch (error) {
        console.error("Project create error");
        console.error(error);
        if (error instanceof Error) {
            return NextResponse.json({
                error: error.message,
                stack: process.env.NODE_ENV === "development" ? error.stack : undefined
            }, { status: 500 });
        }

        return NextResponse.json({ error: "Internal Server Error " }, { status: 500 });
    }

}

export async function GET() {
    const { user, error } = await requireDbUser();
    if (error) return error;

    try {
        const projects = await prisma.project.findMany({
            where: {
                user: {
                    clerkId: user.clerkId
                }
            },
            select: {
                id: true,
                name: true,
                description: true,
                createdAt: true,
                status: true
            }
        })
        return NextResponse.json({ projects: projects }, { status: 200 });
    } catch (error) {
        return NextResponse.json({ msg: "Internal Server Error" }, { status: 500 });
    }

}