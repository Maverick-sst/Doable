import type { MemoryKind } from "@prisma/client";

export type MemoryCurationTrigger =
  | "discovery"
  | "build"
  | "manual"
  | "correction";

export interface MemorySourceRef {
  kind: string;
  id: string;
}

/**
 * A proposed memory before conflict resolution. `expiresAt` is an ISO string
 * because candidates cross the Temporal activity boundary.
 */
export interface MemoryCandidate {
  scope: "PROJECT" | "USER";
  kind: MemoryKind;
  /** Logical slot; a newer entry for the same subject supersedes the active one. */
  subject: string;
  content: string;
  data?: unknown;
  confidence: number;
  sourceKind: string;
  sourceId?: string | null;
  sourceRefs?: MemorySourceRef[];
  expiresAt?: string | null;
}

export interface MemoryMergeResult {
  insertedIds: string[];
  inserted: number;
  superseded: number;
  unchanged: number;
  skipped: number;
}

export interface MemoryEmbeddingResult {
  embedded: number;
  skipped: number;
  failed: number;
}

export interface MemoryCurationResult {
  collected: number;
  inserted: number;
  superseded: number;
  unchanged: number;
  skipped: number;
  embedded: number;
  embedSkipped: number;
  embedFailed: number;
  pruned: number;
}
