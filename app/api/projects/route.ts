import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireDbUser } from "@/lib/auth-user";
import { ProjectDomainSchema } from "@/src/shared/validations/project-domain";
import { ProjectStatus } from "@prisma/client";
import { z } from "zod";

const CreateProjectSchema = z.object({
  domain: ProjectDomainSchema.shape.domain,
});

export async function POST(request: Request) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON format" }, { status: 400 });
  }

  const validation = CreateProjectSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.flatten() }, { status: 400 });
  }

  const { domain } = validation.data;

  try {
    let projectId = "";

    await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { name: "", userId: user.id, status: ProjectStatus.DISCOVERY },
      });
      projectId = project.id;

      await tx.projectMemory.create({
        data: {
          projectId: project.id,
          domain,
          requirements: {},
          techStack: {},
          summary: "",
        },
      });
    });

    return NextResponse.json({ projectId, message: "Project created successfully" }, { status: 201 });
  } catch (err) {
    console.error("Project create error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET() {
  const { user, error } = await requireDbUser();
  if (error) return error;

  try {
    const projects = await prisma.project.findMany({
      where: {
        user: {
          clerkId: user.clerkId,
        },
      },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        status: true,
      },
    });
    return NextResponse.json({ projects }, { status: 200 });
  } catch (error) {
    console.error("Projects list error:", error);
    return NextResponse.json({ msg: "Internal Server Error" }, { status: 500 });
  }
}