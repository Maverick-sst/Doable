import { NodeStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { FailureContext } from "../types";

export const DEFAULT_FAILURE_LIMIT = 5;
const MAX_FAILURE_REASON_CHARS = 500;

/**
 * Prior failed or incomplete node attempts across the project's executions.
 * This gives a repair or retry pass the exact terminal reasons without
 * scanning the whole event ledger.
 */
export async function retrieveFailures(
  projectId: string,
  limit: number = DEFAULT_FAILURE_LIMIT,
): Promise<FailureContext[]> {
  const executions = await prisma.execution.findMany({
    where: { workflow: { projectId } },
    select: { id: true },
  });
  if (executions.length === 0) return [];

  const nodes = await prisma.node.findMany({
    where: {
      executionId: { in: executions.map((execution) => execution.id) },
      status: { in: [NodeStatus.FAILED, NodeStatus.INCOMPLETE] },
    },
    orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
    take: Math.max(1, limit),
    select: {
      id: true,
      executionId: true,
      type: true,
      status: true,
      failureReason: true,
      finishedAt: true,
    },
  });

  return nodes.map((node) => ({
    nodeId: node.id,
    executionId: node.executionId,
    nodeType: node.type,
    status: node.status,
    failureReason: (node.failureReason ?? "unknown").slice(
      0,
      MAX_FAILURE_REASON_CHARS,
    ),
    finishedAt: node.finishedAt?.toISOString() ?? null,
  }));
}
