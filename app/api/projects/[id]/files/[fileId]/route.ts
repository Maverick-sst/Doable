import { inngest } from "@/app/inngest/client";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { UpdateFileSchema } from "@/lib/validations/file";
import { Prisma } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";
import { NextResponse } from "next/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string, fileId: string }> }) {
    const { id, fileId } = await params;
    if (!id) {
        return NextResponse.json({
            error: "Missing PromiseId"
        }, { status: 400 });
    }
    if (!fileId) {
        return NextResponse.json({
            error: "Missing fileId"
        }, { status: 400 })
    };
    const { user, error } = await requireDbUser();
    if (error) return error;
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
    try {
        const file = await prisma.file.findFirstOrThrow({
            where: {
                id: fileId,
                project: {
                    id: project.id
                }
            },
            select: {
                id: true,
                path: true,
                content: true,
                createdAt: true,
                updatedAt: true,
                projectId: true,
            }
        })
        return NextResponse.json({
            file: file,
            message: "File fetched successfully"
        }, { status: 200 });
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025"
        ) {
            return NextResponse.json({
                error: "File doesn't exist"
            }, { status: 404 });
        };

        return NextResponse.json({
            error: "Internal Server Error"
        }, { status: 500 });
    }

}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string, fileId: string }> }) {
    const { id, fileId } = await params;
    if (!id) {
        return NextResponse.json({
            error: "Missing PromiseId"
        }, { status: 400 })
    }
    if (!fileId) {
        return NextResponse.json({
            error: "Missing fileId"
        }, { status: 400 });
    }
    const { user, error } = await requireDbUser();
    if (error) return error;
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
    } catch (error) {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validationResult = UpdateFileSchema.safeParse(body);
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
        await prisma.file.update({
            where: {
                id: fileId,
                project: {
                    id: project.id
                }
            },
            data: {
                path: path,
                content: content
            }
        })

        // trigger inngest event to process embeddings in background
        try {
            await inngest.send({
                name: "file/embedding-requested",
                data: {
                    projectId: project.id,
                    fileId: fileId,
                    content: content ?? "",
                }
            })
        } catch (error) {
            return NextResponse.json({ error: "Failed to send event to inngest" }, { status: 500 });
        }

        return NextResponse.json({ message: "File updated successfully" }, { status: 200 });
    } catch (error) {
        if (error instanceof PrismaClientKnownRequestError && error.code === "P2025") {
            return NextResponse.json({
                error: "File not found"
            }, { status: 404 });
        }
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}


export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string, fileId: string }> }) {
    const { id, fileId } = await params;
    if (!id) {
        return NextResponse.json({
            error: "Missing PromiseId"
        }, { status: 400 })
    }
    if (!fileId) {
        return NextResponse.json({
            error: "Missing fileId"
        }, { status: 400 });
    }
    const { user, error } = await requireDbUser();
    if (error) return error;
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
    try {
        const file = await prisma.file.delete({
            where: {
                id: fileId
            }
        })
        return NextResponse.json({
            message: "File Deleted Successfully"
        }, { status: 204 });
    } catch (error) {
        if (error instanceof PrismaClientKnownRequestError && error.code === "P2025") {
            return NextResponse.json({
                error: "File not found"
            }, { status: 404 });
        }
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

