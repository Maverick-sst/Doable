import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { githubErrorResponse } from "@/lib/github-response";
import {
  getBranchHead,
  getRepository,
} from "@/src/runtime/github/client";
import { GitHubError } from "@/src/runtime/github/errors";
import {
  encryptionConfigured,
  envGitHubToken,
  resolveGitHubToken,
} from "@/src/runtime/github/token-crypto";

const LinkSchema = z.object({
  owner: z
    .string()
    .min(1)
    .max(39)
    .regex(/^[A-Za-z0-9-]+$/),
  repo: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9._-]+$/),
  branch: z.string().min(1).max(200).optional(),
});

async function projectForUser(projectId: string, userId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, userId, archivedAt: null },
    select: { id: true, name: true },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id: projectId } = await params;
  const project = await projectForUser(projectId, user.id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const [link, connection, pushes] = await Promise.all([
    prisma.projectGitHubLink.findUnique({ where: { projectId } }),
    prisma.gitHubConnection.findUnique({
      where: { userId: user.id },
      select: { login: true, tokenLast4: true },
    }),
    prisma.gitHubPush.findMany({
      where: { projectId, userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return NextResponse.json({
    configured: Boolean(connection || envGitHubToken()),
    encryptionConfigured: encryptionConfigured(),
    envTokenConfigured: Boolean(envGitHubToken()),
    connection,
    link: link
      ? {
          owner: link.owner,
          repo: link.repo,
          defaultBranch: link.defaultBranch,
          htmlUrl: link.htmlUrl,
          updatedAt: link.updatedAt,
        }
      : null,
    pushes,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id: projectId } = await params;
  const project = await projectForUser(projectId, user.id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = LinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid repository link payload" },
      { status: 400 },
    );
  }

  try {
    const connection = await prisma.gitHubConnection.findUnique({
      where: { userId: user.id },
    });
    const token = resolveGitHubToken(connection);
    const repo = await getRepository(
      token,
      parsed.data.owner,
      parsed.data.repo,
    );
    if (
      repo.permissions &&
      repo.permissions.push === false &&
      repo.permissions.admin !== true
    ) {
      throw new GitHubError(
        "forbidden",
        "GitHub token does not have push access to this repository",
        403,
      );
    }

    const baseBranch = parsed.data.branch ?? repo.defaultBranch;
    try {
      await getBranchHead(token, parsed.data.owner, parsed.data.repo, baseBranch);
    } catch (cause) {
      if (
        cause instanceof GitHubError &&
        cause.code === "not_found" &&
        baseBranch === repo.defaultBranch
      ) {
        throw new GitHubError(
          "empty_repository",
          "GitHub repository has no commits yet",
          409,
        );
      }
      throw cause;
    }

    const link = await prisma.projectGitHubLink.upsert({
      where: { projectId: project.id },
      update: {
        connectionId: connection?.id ?? null,
        owner: parsed.data.owner,
        repo: parsed.data.repo,
        defaultBranch: baseBranch,
        htmlUrl: repo.htmlUrl,
      },
      create: {
        projectId: project.id,
        connectionId: connection?.id ?? null,
        owner: parsed.data.owner,
        repo: parsed.data.repo,
        defaultBranch: baseBranch,
        htmlUrl: repo.htmlUrl,
      },
    });

    return NextResponse.json({
      link: {
        owner: link.owner,
        repo: link.repo,
        defaultBranch: link.defaultBranch,
        htmlUrl: link.htmlUrl,
        updatedAt: link.updatedAt,
      },
    });
  } catch (cause) {
    return githubErrorResponse(cause);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id: projectId } = await params;
  const project = await projectForUser(projectId, user.id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.gitHubPush.updateMany({
      where: { projectId, userId: user.id, status: "PENDING" },
      data: { status: "CANCELLED" },
    }),
    prisma.projectGitHubLink.deleteMany({ where: { projectId } }),
  ]);
  return NextResponse.json({ ok: true });
}
