import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { githubErrorResponse } from "@/lib/github-response";
import { getAuthenticatedUser } from "@/src/runtime/github/client";
import { resetGitHubHealthCache } from "@/src/runtime/github/health";
import {
  encryptGitHubToken,
  encryptionConfigured,
  envGitHubToken,
} from "@/src/runtime/github/token-crypto";

const TokenSchema = z.object({
  token: z.string().min(20).max(512),
});

export async function GET() {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const connection = await prisma.gitHubConnection.findUnique({
    where: { userId: user.id },
    select: {
      login: true,
      tokenLast4: true,
      scopes: true,
      lastCheckedAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    configured: Boolean(connection || envGitHubToken()),
    encryptionConfigured: encryptionConfigured(),
    envTokenConfigured: Boolean(envGitHubToken()),
    connection: connection
      ? {
          login: connection.login,
          tokenLast4: connection.tokenLast4,
          scopes: connection.scopes,
          lastCheckedAt: connection.lastCheckedAt,
          updatedAt: connection.updatedAt,
        }
      : null,
  });
}

export async function POST(request: Request) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = TokenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid GitHub token payload" },
      { status: 400 },
    );
  }

  try {
    const token = parsed.data.token.trim();
    const githubUser = await getAuthenticatedUser(token);
    const encrypted = encryptGitHubToken(token);
    const connection = await prisma.$transaction(async (tx) => {
      const saved = await tx.gitHubConnection.upsert({
        where: { userId: user.id },
        update: {
          login: githubUser.login,
          ...encrypted,
          lastCheckedAt: new Date(),
        },
        create: {
          userId: user.id,
          login: githubUser.login,
          ...encrypted,
          lastCheckedAt: new Date(),
        },
      });
      await tx.projectGitHubLink.updateMany({
        where: { connectionId: null, project: { userId: user.id } },
        data: { connectionId: saved.id },
      });
      return saved;
    });

    resetGitHubHealthCache(user.id);
    return NextResponse.json({
      connection: {
        login: connection.login,
        tokenLast4: connection.tokenLast4,
        updatedAt: connection.updatedAt,
      },
    });
  } catch (cause) {
    return githubErrorResponse(cause);
  }
}

export async function DELETE() {
  const { user, error } = await requireDbUser();
  if (error) return error;

  await prisma.gitHubConnection.deleteMany({ where: { userId: user.id } });
  resetGitHubHealthCache(user.id);
  return NextResponse.json({ ok: true });
}
