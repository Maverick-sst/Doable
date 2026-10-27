import * as wf from "@temporalio/workflow";
import {
  DATABASE_ACTIVITY_TIMEOUT,
  MEMORY_ACTIVITY_TIMEOUT,
  NODE_ACTIVITY_ATTEMPTS,
} from "../workflow-timeouts";
import type {
  MemoryCurationWorkflowInput,
  MemoryCurationWorkflowResult,
} from "../contracts/memory";

// Memory curation is independent of build execution: if it fails, the build
// is unaffected. Every activity is idempotent (contentKey dedupe), so retries
// are safe.
const { collectMemoryCandidatesActivity, mergeMemoryCandidatesActivity } =
  wf.proxyActivities<typeof import("../activities/memoryActivities")>({
    startToCloseTimeout: DATABASE_ACTIVITY_TIMEOUT,
    retry: { maximumAttempts: NODE_ACTIVITY_ATTEMPTS },
  });

const { embedMemoryEntriesActivity, pruneExpiredMemoryActivity } =
  wf.proxyActivities<typeof import("../activities/memoryActivities")>({
    startToCloseTimeout: MEMORY_ACTIVITY_TIMEOUT,
    retry: { maximumAttempts: NODE_ACTIVITY_ATTEMPTS },
  });

/**
 * Bounded curation: collect deterministic candidates from durable state,
 * merge them with conflict/idempotency rules, embed the new rows, and prune
 * expired episodic memory. Started fire-and-forget after a build or
 * discovery; never part of the build's success path.
 */
export async function memoryCurationWorkflow(
  input: MemoryCurationWorkflowInput,
): Promise<MemoryCurationWorkflowResult> {
  const candidates = await collectMemoryCandidatesActivity({
    projectId: input.projectId,
    trigger: input.trigger,
    executionId: input.executionId ?? null,
  });

  const merged = await mergeMemoryCandidatesActivity({
    projectId: input.projectId,
    userId: input.userId ?? null,
    candidates,
  });

  const embedding = await embedMemoryEntriesActivity({
    ids: merged.insertedIds,
  });

  const pruned = await pruneExpiredMemoryActivity({
    projectId: input.projectId,
  });

  return {
    collected: candidates.length,
    inserted: merged.inserted,
    superseded: merged.superseded,
    unchanged: merged.unchanged,
    skipped: merged.skipped,
    embedded: embedding.embedded,
    embedSkipped: embedding.skipped,
    embedFailed: embedding.failed,
    pruned,
  };
}
