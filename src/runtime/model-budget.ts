import { prisma } from "@/lib/prisma";

export class ModelTokenBudgetExceededError extends Error {
  readonly limit: number;
  readonly used: number;

  constructor(limit: number, used: number) {
    super(
      `Model token budget exceeded: ${used} used of ${limit} allowed for this execution`,
    );
    this.name = "ModelTokenBudgetExceededError";
    this.limit = limit;
    this.used = used;
  }
}

/** `0` disables the per-execution token budget. */
export function resolveRunTokenBudget(): number {
  const parsed = Number.parseInt(process.env.RUN_TOKEN_BUDGET ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function sumUsageTokens(payloads: unknown[]): number {
  let total = 0;
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object") continue;
    const value = (payload as { totalTokens?: unknown }).totalTokens;
    if (typeof value === "number" && Number.isFinite(value)) {
      total += value;
    }
  }
  return total;
}

export async function getExecutionTokenUsage(
  executionId: string,
): Promise<number> {
  const events = await prisma.runtimeEvent.findMany({
    where: { executionId, type: "model.usage" },
    select: { payload: true },
  });
  return sumUsageTokens(events.map((event) => event.payload));
}

/**
 * Durable usage gate. Called before a model request; sums provider-reported
 * usage already recorded for this execution. A disabled budget performs no
 * query.
 */
export async function assertModelTokenBudget(
  executionId: string,
): Promise<void> {
  const limit = resolveRunTokenBudget();
  if (limit <= 0) return;
  const used = await getExecutionTokenUsage(executionId);
  if (used >= limit) {
    throw new ModelTokenBudgetExceededError(limit, used);
  }
}
