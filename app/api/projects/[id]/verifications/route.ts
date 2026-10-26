import { NextResponse } from "next/server";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import {
  latestVerification,
  recordVerification,
  runStructuralVerification,
} from "@/src/runtime/verification";

async function requireProject(projectId: string, userId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id } = await params;
  const project = await requireProject(id, user.id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({
    verification: await latestVerification(project.id),
  });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id } = await params;
  const project = await requireProject(id, user.id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const result = await runStructuralVerification(project.id);
  const report = await recordVerification({
    projectId: project.id,
    result,
  });

  return NextResponse.json({ verification: report }, { status: 201 });
}