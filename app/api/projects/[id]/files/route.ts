import { NextResponse } from "next/server";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { CreateFileSchema } from "@/src/shared/validations/file";
import {
  createProjectFile,
  FileConflictError,
  listProjectFiles,
} from "@/src/runtime/files";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id: projectId } = await params;
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id, archivedAt: null },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ files: await listProjectFiles(projectId) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, userId: user.id, archivedAt: null },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = CreateFileSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request payload", details: validation.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const file = await createProjectFile({
      projectId: project.id,
      path: validation.data.path,
      content: validation.data.content ?? "",
    });

    return NextResponse.json(
      {
        projectId: project.id,
        fileId: file.id,
        path: file.path,
        createdAt: file.createdAt,
        message: "File created successfully",
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof FileConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}