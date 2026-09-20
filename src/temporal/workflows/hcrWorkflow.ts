import * as wf from "@temporalio/workflow";
import type {
  TemporalHcrWorkflowInput,
  TemporalHcrResult,
} from "../contracts/hcr";

// Activities own all I/O (Prisma reads). The workflow only orchestrates order
// and carries small serializable state, keeping replay deterministic.
const { validateHcrContext, runHcrNodeBoundary } = wf.proxyActivities<
  typeof import("../activities/hcrActivities")
>({
  // Conservative skeleton policy: short DB-bound steps, few retries.
  // Agent 03 tunes the node boundary (LLM + tools need minutes, not seconds).
  // Retrying validation is safe (read-only); retrying the future real node
  // requires the idempotency Agent 03 must prove — hence small attempt caps here.
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});

/**
 * Minimal HCR orchestration skeleton:
 * execution received → validate context → single node boundary → result.
 *
 * Postgres remains the product source of truth; Temporal only decides WHEN
 * each Activity runs and survives worker restarts between them.
 */
export async function hcrWorkflow(
  input: TemporalHcrWorkflowInput,
): Promise<TemporalHcrResult> {
  const validated = await validateHcrContext({ identity: input.identity });

  const nodeResult = await runHcrNodeBoundary({ identity: input.identity });

  return {
    doableProjectId: validated.doableProjectId,
    doableWorkflowId: validated.doableWorkflowId,
    doableExecutionId: validated.doableExecutionId,
    doableNodeId: nodeResult.doableNodeId,
    executionStatus: validated.executionStatus,
    nodeMigrated: nodeResult.nodeMigrated,
    temporalWorkflowId: wf.workflowInfo().workflowId,
  };
}
