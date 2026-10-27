import { MemoryKind, MemoryStatus } from "@prisma/client";
import { sha256 } from "@/src/hcr/agent-config/hash";

export const DEFAULT_EPISODIC_RETENTION_DAYS = 90;
export const MEMORY_MAX_CONTENT_CHARS = 4_000;

export function resolveEpisodicRetentionDays(): number {
  const parsed = Number.parseInt(
    process.env.MEMORY_EPISODIC_RETENTION_DAYS ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_EPISODIC_RETENTION_DAYS;
}

/** Newlines are meaningful; surrounding and repeated horizontal space is not. */
export function normalizeMemoryContent(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

export function memoryContentHash(content: string): string {
  return sha256(normalizeMemoryContent(content));
}

export function memoryContentKey(input: {
  scope: string;
  projectId?: string | null;
  userId?: string | null;
  kind: string;
  subject: string;
  contentHash: string;
}): string {
  return [
    input.scope,
    input.projectId ?? "-",
    input.userId ?? "-",
    input.kind,
    input.subject,
    input.contentHash,
  ].join(":");
}

/** Episodic memory ages out; durable kinds are superseded instead. */
export function memoryExpiry(
  kind: MemoryKind,
  now: Date,
  retentionDays = resolveEpisodicRetentionDays(),
): Date | null {
  if (kind !== MemoryKind.EPISODIC) return null;
  return new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

export type MemoryMergeDecision = "insert" | "noop" | "supersede" | "skip";

/**
 * Conflict policy, in order:
 *
 * 1. identical content is a no-op (idempotent retries);
 * 2. an active user correction outranks curated memory;
 * 3. a user correction supersedes a curated entry for the same subject;
 * 4. otherwise the newer curated entry supersedes the older one.
 */
export function decideMemoryMerge(
  existing:
    | { contentHash: string; sourceKind: string; status: MemoryStatus }
    | null,
  incoming: { contentHash: string; sourceKind: string },
): MemoryMergeDecision {
  if (!existing || existing.status !== MemoryStatus.ACTIVE) return "insert";
  if (existing.contentHash === incoming.contentHash) return "noop";
  if (
    existing.sourceKind === "user-correction" &&
    incoming.sourceKind !== "user-correction"
  ) {
    return "skip";
  }
  return "supersede";
}
