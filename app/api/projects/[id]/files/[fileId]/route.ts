import { NextResponse } from "next/server";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { UpdateFileSchema } from "@/src/shared/validations/file";
import {
  deleteProjectFile,
  FileNotFoundError,
  readProjectFile,
  updateProjectFile,
} from "@/src/runtime/files";

async function findFile(projectId: string, fileId: string) {
  return prisma.file.findFirst({
    where: { id: fileId, projectId },
    select: { id: true, path: true },
  });
}

async function requireProject(projectId: string, userId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, userId, archivedAt: null },
    select: { id: true },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id, fileId } = await params;
  const project = await requireProject(id, user.id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const metadata = await findFile(project.id, fileId);
  if (!metadata) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const file = await readProjectFile({
      projectId: project.id,
      path: metadata.path,
    });
    return NextResponse.json({ file });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id, fileId } = await params;
  const project = await requireProject(id, user.id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const metadata = await findFile(project.id, fileId);
  if (!metadata) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = UpdateFileSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request payload", details: validation.error.flatten() },
      { status: 400 },
    );
  }

  // Renaming is a separate operation from content update; keep the path the
  // same here so the workspace and DB cannot diverge.
  if (validation.data.path && validation.data.path !== metadata.path) {
    return NextResponse.json(
      { error: "Renaming a file is not supported by this endpoint" },
      { status: 400 },
    );
  }

  if (validation.data.content === undefined) {
    return NextResponse.json(
      { error: "content is required for an update" },
      { status: 400 },
    );
  }

  try {
    const updated = await updateProjectFile({
      projectId: project.id,
      path: metadata.path,
      content: validation.data.content,
    });
    return NextResponse.json({ file: updated, message: "File updated successfully" });
  } catch (error) {
    if (error instanceof FileNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id, fileId } = await params;
  const project = await requireProject(id, user.id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const metadata = await findFile(project.id, fileId);
  if (!metadata) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  await deleteProjectFile({ projectId: project.id, path: metadata.path });
  return new NextResponse(null, { status: 204 });
}