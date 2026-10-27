import type { MemoryCurationTrigger } from "@/src/runtime/memory/types";
import type {
  MemoryCandidate,
  MemoryEmbeddingResult,
  MemoryMergeResult,
} from "@/src/runtime/memory/types";

export interface MemoryCurationWorkflowInput {
  projectId: string;
  userId?: string | null;
  trigger: MemoryCurationTrigger;
  executionId?: string | null;
}

export interface MemoryCurationWorkflowResult {
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

export interface CollectMemoryCandidatesActivityInput {
  projectId: string;
  trigger: MemoryCurationTrigger;
  executionId?: string | null;
}

export interface MergeMemoryCandidatesActivityInput {
  projectId: string;
  userId?: string | null;
  candidates: MemoryCandidate[];
}

export type MergeMemoryCandidatesActivityResult = MemoryMergeResult;
export type EmbedMemoryEntriesActivityResult = MemoryEmbeddingResult;
