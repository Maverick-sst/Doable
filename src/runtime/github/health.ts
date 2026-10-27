import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "./client";
import { envGitHubToken, resolveGitHubToken } from "./token-crypto";
import { probeGitHubMcp } from "@/src/runtime/mcp/client";
import { githubMcpEnabled } from "@/src/runtime/mcp/servers";

export type GitHubIntegrationHealth = {
  configured: boolean;
  connected: boolean;
  mcpReachable: boolean;
  lastCheckedAt: string | null;
};

const CACHE_MS = 60_000;
const cache = new Map<string, { value: GitHubIntegrationHealth; at: number }>();

export async function githubIntegrationHealth(
  userId: string | null,
): Promise<GitHubIntegrationHealth> {
  const cacheKey = userId ?? "anonymous";
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const connection = userId
    ? await prisma.gitHubConnection.findUnique({ where: { userId } })
    : null;
  const configured = Boolean(connection || envGitHubToken());
  if (!configured) {
    const value = {
      configured: false,
      connected: false,
      mcpReachable: false,
      lastCheckedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, { value, at: Date.now() });
    return value;
  }

  let connected = false;
  let mcpReachable = false;
  try {
    const token = resolveGitHubToken(connection);
    await getAuthenticatedUser(token);
    connected = true;
    if (githubMcpEnabled()) {
      mcpReachable = await probeGitHubMcp(token);
    }
  } catch {
    connected = false;
  }

  const value = {
    configured,
    connected,
    mcpReachable,
    lastCheckedAt: new Date().toISOString(),
  };
  cache.set(cacheKey, { value, at: Date.now() });
  return value;
}

export function resetGitHubHealthCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}
