import { prisma } from "@/lib/prisma";
import { CreateFileSchema } from "@/lib/validations/file";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireDbUser } from "@/lib/auth-user";
import { inngest } from "@/app/inngest/client";

// post request to create a new file in db
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, error } = await requireDbUser();
    if (error) return error;
    const { id } = await params;

    if (!id) {
        return NextResponse.json({ error: "Missing project id" }, { status: 400 });
    }

    const project = await prisma.project.findFirst({
        where: {
            id: id,
            user: {
                clerkId: user.clerkId
            }
        }
    });
    if (!project) {
        return NextResponse.json({
            error: "Project not found"
        }, { status: 404 });
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validationResult = CreateFileSchema.safeParse(body);
    if (!validationResult.success) {
        return NextResponse.json(
            {
                error: "Invalid request payload",
                details: validationResult.error.flatten(),
            },
            { status: 400 }
        );
    }

    const { path, content } = validationResult.data;

    try {
        const file = await prisma.file.create({
            data: {
                path,
                content: content ?? "",
                projectId: project.id,
            },
            select: {
                id: true,
                path: true,
                createdAt: true,
            },
        });
        // trigger inngest event to process embeddings in background
        try {
            await inngest.send({
                name: "file/embedding-requested",
                data: {
                    projectId: project.id,
                    fileId: file.id,
                    content: content ?? "",
                }
            })
        } catch (error) {
            return NextResponse.json({ error: "Failed to send event to inngest" }, { status: 500 });
        }

        return NextResponse.json({
            projectId: project.id,
            fileId: file.id,
            path: file.path,
            createdAt: file.createdAt,
            message: "File created successfully",
        }, { status: 201 });



    } catch (error: unknown) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
        ) {
            return NextResponse.json(
                { error: "A file with this path already exists in this project" },
                { status: 409 }
            );
        }

        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

}