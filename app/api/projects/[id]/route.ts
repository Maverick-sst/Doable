import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { invalidateProjectCache } from "@/src/runtime/cache";

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  archived: z.boolean().optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing project id" }, { status: 400 });
  }

  const { user, error } = await requireDbUser();
  if (error) return error;

  const project = await prisma.project.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      status: true,
      failureReason: true,
      archivedAt: true,
      workspacePath: true,
      files: {
        orderBy: { path: "asc" },
        select: {
          id: true,
          path: true,
          size: true,
          revision: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        take: 200,
        select: {
          id: true,
          role: true,
          content: true,
          phase: true,
          createdAt: true,
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ project });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing project id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON format" }, { status: 400 });
  }

  const parsed = UpdateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid project payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const existing = await prisma.project.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const updated = await prisma.project.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
      ...(parsed.data.archived !== undefined
        ? { archivedAt: parsed.data.archived ? new Date() : null }
        : {}),
    },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      archivedAt: true,
    },
  });

  return NextResponse.json({ project: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing project id" }, { status: 400 });
  }

  const { user, error } = await requireDbUser();
  if (error) return error;

  const deleted = await prisma.project.deleteMany({
    where: { id, userId: user.id },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Drop hot entries immediately; the FK cascade removes durable rows.
  await invalidateProjectCache(id);

  return new NextResponse(null, { status: 204 });
}
