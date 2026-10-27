import { NextResponse } from "next/server";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import {
  latestVerification,
  listVerificationAttempts,
} from "@/src/runtime/verification";
import {
  startVerification,
  VerificationStartError,
} from "@/src/runtime/verification/start";

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

  const [verification, attempts] = await Promise.all([
    latestVerification(project.id),
    listVerificationAttempts(project.id),
  ]);

  return NextResponse.json({ verification, attempts });
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

  try {
    const { report, temporalWorkflowId } = await startVerification({
      projectId: project.id,
      userId: user.id,
    });
    return NextResponse.json(
      { verification: report, temporalWorkflowId },
      { status: 202 },
    );
  } catch (startError) {
    if (startError instanceof VerificationStartError) {
      return NextResponse.json(
        { error: startError.message },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Could not start verification" },
      { status: 500 },
    );
  }
}
