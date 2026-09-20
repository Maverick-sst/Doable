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

/**
 * First HCR vertical slice through Temporal:
 * execution received → validate context → real ARCHITECT node → result.
 *
 * ARCHITECT verified as the first node against HCR_MIGRATION_MAP.md §2 (chat
 * entry always emits ARCHITECT order:1). Later nodes stay on Inngest until
 * their own adapter tasks; this workflow intentionally stops after ARCHITECT
 * and returns the artifact correlation for the caller/coordinator.
 *
 * Postgres remains the product source of truth; Temporal only decides WHEN
 * each Activity runs and survives worker restarts between them.
 */
export async function hcrWorkflow(
  input: TemporalHcrWorkflowInput,
): Promise<TemporalHcrResult> {
  const validated = await validateHcrContext({ identity: input.identity });

  const nodeResult = await runArchitectNode({
    identity: input.identity,
    prompt: input.prompt,
    inputArtifactId: input.inputArtifactId ?? null,
  });

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
