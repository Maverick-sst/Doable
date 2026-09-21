import { MessagePhase } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Raw history entry; role normalization stays in the assembler. */
export interface HistoryMessage {
  role: string;
  content: string;
}

/**
 * BUILD-phase message retrieval, moved verbatim from `node-executor`.
 * Same project scope, same phase filter, same limit (10), same ordering
 * (newest-first fetch, reversed to chronological). Dormant-policy behavior
 * is preserved by the caller-side gate: the engine only calls this when
 * `includeMessageHistory` is true (false in every registry entry).
 */
export async function retrieveMessageHistory(
  projectId: string,
): Promise<HistoryMessage[]> {
  const dbMessages = await prisma.message.findMany({
    where: { projectId, phase: MessagePhase.BUILD },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { role: true, content: true },
  });
  return dbMessages.reverse();
}
