import { collectMemoryCandidates } from "@/src/runtime/memory/candidates";
import { pruneExpiredMemory } from "@/src/runtime/memory/curation";
import { embedMemoryEntries } from "@/src/runtime/memory/embeddings";
import { mergeMemoryCandidates } from "@/src/runtime/memory/merge";
import type {
  CollectMemoryCandidatesActivityInput,
  MergeMemoryCandidatesActivityInput,
  MemoryCurationWorkflowInput,
} from "../contracts/memory";

export async function collectMemoryCandidatesActivity(
  input: CollectMemoryCandidatesActivityInput,
) {
  return collectMemoryCandidates(input);
}

export async function mergeMemoryCandidatesActivity(
  input: MergeMemoryCandidatesActivityInput,
) {
  return mergeMemoryCandidates(input);
}

export async function embedMemoryEntriesActivity(input: { ids: string[] }) {
  return embedMemoryEntries(input.ids);
}

export async function pruneExpiredMemoryActivity(
  input: Pick<MemoryCurationWorkflowInput, "projectId">,
) {
  return pruneExpiredMemory(input.projectId);
}
