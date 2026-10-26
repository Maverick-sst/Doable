import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Authentication seam.
 *
 * Local mode is the default for the local-first product: one profile per
 * machine, no network identity provider in the critical path. Hosted mode is
 * intentionally a separate adapter and is not enabled by default.
 */
export type AuthMode = "local" | "hosted";

export type DbUser = {
  id: string;
  clerkId: string;
  email: string;
  createdAt: Date;
};

export type AuthResult =
  | { user: DbUser; error?: never }
  | { user?: never; error: NextResponse };

const LOCAL_CLERK_ID = "local-user";
const LOCAL_EMAIL = "local@doable.local";

export function getAuthMode(): AuthMode {
  return process.env.AUTH_MODE === "hosted" ? "hosted" : "local";
}

export function isLocalMode(): boolean {
  return getAuthMode() === "local";
}

async function getLocalUser(): Promise<DbUser> {
  return prisma.user.upsert({
    where: { clerkId: LOCAL_CLERK_ID },
    update: { email: LOCAL_EMAIL },
    create: { clerkId: LOCAL_CLERK_ID, email: LOCAL_EMAIL },
    select: { id: true, clerkId: true, email: true, createdAt: true },
  });
}

async function getHostedUser(): Promise<DbUser | null> {
  // Dynamic import keeps Clerk out of the local module graph and out of
  // local startup when the optional hosted adapter is not configured.
  const { auth, clerkClient } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  if (!userId) return null;

  const existing = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, clerkId: true, email: true, createdAt: true },
  });
  if (existing) return existing;

  // Brief retry for webhook lag, then self-heal from Clerk.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const retried = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, clerkId: true, email: true, createdAt: true },
  });
  if (retried) return retried;

  const client = await clerkClient();
  const clerkUser = await client.users.getUser(userId);
  const email = clerkUser.emailAddresses[0]?.emailAddress;
  if (!email) return null;

  return prisma.user.upsert({
    where: { clerkId: userId },
    update: { email },
    create: { clerkId: userId, email },
    select: { id: true, clerkId: true, email: true, createdAt: true },
  });
}

export async function getCurrentUser(): Promise<DbUser | null> {
  if (isLocalMode()) return getLocalUser();
  return getHostedUser();
}

export async function requireDbUser(): Promise<AuthResult> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return {
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }
    return { user };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown auth error";
    return {
      error: NextResponse.json(
        { error: "Authentication unavailable", detail: message },
        { status: 503 },
      ),
    };
  }
}