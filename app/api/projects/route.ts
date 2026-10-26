import { NextResponse } from "next/server";
import { z } from "zod";
import { ProjectStatus } from "@prisma/client";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { DomainEnum } from "@/src/shared/validations/project-domain";

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  domain: z.enum(DomainEnum),
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
    return NextResponse.json(
      { error: "Invalid project payload", details: validation.error.flatten() },
      { status: 400 },
    );
  }

  const { name, description, domain } = validation.data;

  try {
    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name,
          description: description ?? null,
          userId: user.id,
          status: ProjectStatus.DISCOVERY,
        },
      });

      await tx.project.update({
        where: { id: created.id },
        data: { workspacePath: `projects/${created.id}` },
      });

      await tx.projectMemory.create({
        data: {
          projectId: created.id,
          domain,
          requirements: {},
          techStack: {},
          summary: "",
        },
      });

      return created;
    });

    return NextResponse.json(
      {
        projectId: project.id,
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          status: project.status,
          createdAt: project.createdAt,
        },
        message: "Project created successfully",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Project create error:", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET() {
  const { user, error } = await requireDbUser();
  if (error) return error;

  try {
    const projects = await prisma.project.findMany({
      where: { userId: user.id, archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        status: true,
        failureReason: true,
      },
    });
    return NextResponse.json({ projects }, { status: 200 });
  } catch (error) {
    console.error("Projects list error:", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}