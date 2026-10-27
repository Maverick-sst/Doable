import { proxyActivities } from "@temporalio/workflow";
import type {
  RunRepairActivityInput,
  RunRepairActivityOutput,
  RunVerificationActivityInput,
  RunVerificationActivityOutput,
  VerificationWorkflowInput,
  VerificationWorkflowResult,
} from "@/src/temporal/contracts/verification";
import {
  REPAIR_ACTIVITY_TIMEOUT,
  VERIFICATION_ACTIVITY_TIMEOUT,
} from "@/src/temporal/workflow-timeouts";

const verificationActivities = proxyActivities<{
  runVerificationActivity(
    input: RunVerificationActivityInput,
  ): Promise<RunVerificationActivityOutput>;
}>({
  startToCloseTimeout: VERIFICATION_ACTIVITY_TIMEOUT,
  retry: { maximumAttempts: 1 },
});

const repairActivities = proxyActivities<{
  runRepairActivity(
    input: RunRepairActivityInput,
  ): Promise<RunRepairActivityOutput>;
}>({
  startToCloseTimeout: REPAIR_ACTIVITY_TIMEOUT,
  retry: { maximumAttempts: 1 },
});

/**
 * One bounded loop: verify, repair, verify again. A later attempt is only
 * meaningful when repair actually changed files. Only the final PASSED report
 * counts as verified; a failed repair leaves the last report FAILED/BLOCKED.
 */
export async function verificationWorkflow(
  input: VerificationWorkflowInput,
): Promise<VerificationWorkflowResult> {
  const reportIds: string[] = [];
  let reportId: string | null = input.reportId;
  let parentReportId: string | null = null;
  let attempt = input.initialAttempt;
  let repaired = false;
  let lastStatus: VerificationWorkflowResult["status"] = "BLOCKED";
  let lastPreview: string | null = null;

  while (attempt <= input.maxAttempts) {
    const verification: RunVerificationActivityOutput =
      await verificationActivities.runVerificationActivity({
        projectId: input.projectId,
        reportId,
        parentReportId,
        attempt,
        executionId: input.executionId ?? null,
        nodeId: input.nodeId ?? null,
        keepPreview: input.keepPreview,
      });

    const currentReportId = verification.reportId;
    reportId = currentReportId;
    lastStatus = verification.status;
    lastPreview = verification.previewUrl;
    if (!reportIds.includes(currentReportId)) reportIds.push(currentReportId);

    if (verification.status === "PASSED") {
      return {
        reportId: currentReportId,
        status: "PASSED",
        attempts: attempt,
        previewUrl: verification.previewUrl,
        repaired,
        reportIds,
      };
    }

    // Repair is for application failures with real evidence. A blocked
    // sandbox or an ambiguous check must not spend a model call or mutate the
    // workspace.
    if (verification.status !== "FAILED") break;
    if (attempt >= input.maxAttempts) break;

    const repair: RunRepairActivityOutput =
      await repairActivities.runRepairActivity({
        projectId: input.projectId,
        userId: input.userId,
        reportId: currentReportId,
        attempt,
        executionId: input.executionId ?? null,
        nodeId: input.nodeId ?? null,
      });

    if (!repair.changed) break;

    repaired = true;
    attempt += 1;
    parentReportId = currentReportId;
    // The next verification activity creates a fresh RUNNING report linked to
    // the failed report through parentReportId.
    reportId = null;
  }

  return {
    reportId: reportIds[reportIds.length - 1] ?? input.reportId,
    status: lastStatus,
    attempts: attempt,
    previewUrl: lastPreview,
    repaired,
    reportIds,
  };
}
