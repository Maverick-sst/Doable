import { MessagePhase } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { HistoryMessage } from "../types";

/**
 * How many BUILD-phase messages retrieval considers. The previous window was
 * 10; V2 fetches a wider slice so compaction can preserve recent context while
 * explicitly reporting what it omitted. Callers can override per policy.
 */
export const DEFAULT_HISTORY_LIMIT = 50;

/**
 * BUILD-phase message retrieval. Same project scope and phase filter as
 * before; newest-first fetch, reversed to chronological order. Deterministic
 * tie-break on id keeps assembly reproducible across worker restarts.
 */
export async function retrieveMessageHistory(
  projectId: string,
  limit: number = DEFAULT_HISTORY_LIMIT,
): Promise<HistoryMessage[]> {
  const dbMessages = await prisma.message.findMany({
    where: { projectId, phase: MessagePhase.BUILD },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.max(1, limit),
    select: { id: true, role: true, content: true, createdAt: true },
  });
  return dbMessages.reverse().map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  }));
}
