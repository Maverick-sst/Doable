import * as wf from "@temporalio/workflow";
import type {
  TemporalHcrWorkflowInput,
  TemporalHcrResult,
} from "../contracts/hcr";

// Validation is a short read-only DB check; the ARCHITECT node performs
// embeddings + up to 3 LLM attempts + artifact writes and needs minutes.
// Separate proxies keep each timeout/retry policy explicit and conservative.
const { validateHcrContext } = wf.proxyActivities<
  typeof import("../activities/hcrActivities")
>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});

// Parity with the Inngest node `retries:3`. Retrying is safe for product state
// because the adapter reuses the artifact by nodeId; see runArchitectNode docs
// for the known duplicate-event limitation on retry.
const { runArchitectNode } = wf.proxyActivities<
  typeof import("../activities/hcrActivities")
>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 3 },
});

// Short, non-retried compensation: it only runs after the node activity has
// exhausted its own retries, and its writes are idempotent (conditional
// updateMany), so a single attempt suffices. Retrying compensation itself
// would only re-hit the same guarded writes.
const { markHcrFailed } = wf.proxyActivities<
  typeof import("../activities/hcrActivities")
>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 1 },
});

/**
 * First HCR vertical slice through Temporal:
 * execution received → validate context → real ARCHITECT node → result.
 *
 * ARCHITECT verified as the first node against HCR_MIGRATION_MAP.md §2 (chat
 * entry always emits ARCHITECT order:1). Later nodes stay on Inngest until
 * their own adapter tasks; this workflow intentionally stops after ARCHITECT
 * and returns the artifact correlation for the caller/coordinator.
 *
 * Failure parity with Inngest (`onFailure → handleFailure`): when the node
 * activity exhausts its retries, the workflow records FAILED rows via
 * `markHcrFailed` (same three statuses + same three event types, Temporal
 * source-tagged) and then rethrows so the Temporal run itself also shows
 * failed. Validation failures skip compensation — nothing ran yet, so the
 * CREATED rows are left untouched for inspection, exactly as the Inngest path
 * leaves an unstarted execution.
 *
 * Postgres remains the product source of truth; Temporal only decides WHEN
 * each Activity runs and survives worker restarts between them.
 */
export async function hcrWorkflow(
  input: TemporalHcrWorkflowInput,
): Promise<TemporalHcrResult> {
  const validated = await validateHcrContext({ identity: input.identity });

  let nodeResult: Awaited<ReturnType<typeof runArchitectNode>>;
  try {
    nodeResult = await runArchitectNode({
      identity: input.identity,
      prompt: input.prompt,
      inputArtifactId: input.inputArtifactId ?? null,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await markHcrFailed({ identity: input.identity, reason });
    throw error;
  }

  return {
    doableProjectId: validated.doableProjectId,
    doableWorkflowId: validated.doableWorkflowId,
    doableExecutionId: validated.doableExecutionId,
    doableNodeId: nodeResult.doableNodeId,
    executionStatus: validated.executionStatus,
    nodeMigrated: nodeResult.nodeMigrated,
    temporalWorkflowId: wf.workflowInfo().workflowId,
    artifactId: nodeResult.artifactId,
    artifactType: nodeResult.artifactType,
    nodeType: nodeResult.nodeType,
  };
}
