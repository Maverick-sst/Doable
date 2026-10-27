import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthMode, getCurrentUser } from "@/src/auth";
import {
  getProviderCapabilitiesOrNull,
  getProviderId,
  providerHealthSnapshot,
  routingSnapshot,
  type ProviderCapabilities,
} from "@/src/providers";
import {
  ensureTemporalConnected,
  getTemporalHost,
  getTemporalTaskQueue,
} from "@/src/temporal/client";
import { getWorkspaceRoot } from "@/src/runtime/workspace";
import { cacheSnapshot } from "@/src/runtime/cache";
import { githubIntegrationHealth } from "@/src/runtime/github/health";

async function checkDatabase(): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Database unavailable",
    };
  }
}

async function checkTemporal(): Promise<{ ok: boolean; error?: string }> {
  try {
    await Promise.race([
      ensureTemporalConnected(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Temporal connection timed out")), 2500),
      ),
    ]);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Temporal unavailable",
    };
  }
}

async function checkGitHub() {
  try {
    const user = await getCurrentUser();
    return await githubIntegrationHealth(user?.id ?? null);
  } catch {
    return {
      configured: false,
      connected: false,
      mcpReachable: false,
      lastCheckedAt: null,
    };
  }
}

export async function GET() {
  const [database, temporal, github] = await Promise.all([
    checkDatabase(),
    checkTemporal(),
    checkGitHub(),
  ]);

  const routing = routingSnapshot();
  let providerId = routing.providerId ?? "unavailable";
  let providerCapabilities: ProviderCapabilities | null = null;
  try {
    providerId = getProviderId();
    providerCapabilities = getProviderCapabilitiesOrNull();
  } catch {
    // The routing snapshot already carries the actionable configuration error.
  }

  const body = {
    database,
    temporal: {
      ...temporal,
      host: getTemporalHost(),
      taskQueue: getTemporalTaskQueue(),
    },
    workspaceRoot: getWorkspaceRoot(),
    authMode: getAuthMode(),
    provider: providerId,
    providerCapabilities,
    routing,
    providerHealth: providerHealthSnapshot(),
    cache: cacheSnapshot(),
    integrations: {
      github,
    },
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, { status: database.ok ? 200 : 503 });
}