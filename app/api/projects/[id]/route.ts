import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";


export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!id) {
        return NextResponse.json({ msg: "Missing Project Id" }, { status: 400 });
    }
    const { user, error } = await requireDbUser();
    if (error) return error;
    try {
        const project = await prisma.project.findFirst({
            where: {
                id: id,
                user: {
                    clerkId: user.clerkId
                }
            },
            select: {
                id: true,
                name: true,
                description: true,
                createdAt: true,
                updatedAt: true,
                status: true,
                files: {
                    select: {
                        id: true,
                        path: true,
                        createdAt: true,
                        updatedAt: true
                    }
                },
                messages: {
                    select: {
                        id: true,
                        role: true,
                        content: true,
                        createdAt: true
                    },
                    orderBy: { createdAt: 'asc' }
                }
            }
        })
        if (!project) {
            return NextResponse.json({ msg: "Project Not Found!" }, { status: 404 });
        }
        return NextResponse.json({ project: project }, { status: 200 });
    } catch (error) {
        return NextResponse.json({ msg: "Internal Server Error" }, { status: 500 });
    }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!id) {
        return NextResponse.json({ msg: "Missing ProjectId" }, { status: 400 });
    }
    const { user, error } = await requireDbUser();
    if(error) return error;
    try {
        const { count } = await prisma.project.deleteMany({
            where: {
                id: id,
                user: {
                    clerkId: user.clerkId
                }
            }
        })
        return count === 1 ? NextResponse.json({ status: 204 }) : NextResponse.json({ msg: "Project not found" }, { status: 404 });
    } catch (error) {
        return NextResponse.json({ msg: "Internal Server Error" }, { status: 500 });
    }
}