import { VerificationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runSandboxVerification } from "@/src/runtime/verification/runner";
import { runRepair } from "@/src/runtime/repair";
import type {
  CreateBuildVerificationReportInput,
  CreateBuildVerificationReportOutput,
  RunRepairActivityInput,
  RunRepairActivityOutput,
  RunVerificationActivityInput,
  RunVerificationActivityOutput,
  VerificationOutcome,
} from "@/src/temporal/contracts/verification";

function outcome(status: VerificationStatus): VerificationOutcome {
  switch (status) {
    case VerificationStatus.PASSED:
      return "PASSED";
    case VerificationStatus.TIMED_OUT:
      return "TIMED_OUT";
    case VerificationStatus.BLOCKED:
      return "BLOCKED";
    default:
      return "FAILED";
  }
}

export async function runVerificationActivity(
  input: RunVerificationActivityInput,
): Promise<RunVerificationActivityOutput> {
  const result = await runSandboxVerification(input.projectId, {
    reportId: input.reportId ?? undefined,
    parentReportId: input.parentReportId ?? null,
    attempt: input.attempt,
    executionId: input.executionId ?? null,
    nodeId: input.nodeId ?? null,
    keepPreview: input.keepPreview,
  });

  const summary = result.steps
    .map((step) => `${step.name}:${step.status}`)
    .join(" ");

  return {
    reportId: result.reportId,
    status: outcome(result.status),
    previewUrl: result.previewUrl,
    summary: `${result.status} ${summary}`.slice(0, 2_000),
  };
}

export async function createBuildVerificationReport(
  input: CreateBuildVerificationReportInput,
): Promise<CreateBuildVerificationReportOutput> {
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const active = await prisma.verificationReport.findFirst({
    where: {
      projectId: input.projectId,
      status: VerificationStatus.RUNNING,
      createdAt: { gt: cutoff },
    },
    select: { id: true },
  });
  if (active) {
    return { reportId: null, reason: "active_verification_exists" };
  }

  const report = await prisma.verificationReport.create({
    data: {
      projectId: input.projectId,
      executionId: input.executionId,
      nodeId: input.nodeId,
      status: VerificationStatus.RUNNING,
      command: "sandbox",
      attempt: 1,
      steps: [],
      evidence: { orchestration: { provider: "temporal", trigger: "build" } },
    },
    select: { id: true },
  });
  return { reportId: report.id };
}

export async function runRepairActivity(
  input: RunRepairActivityInput,
): Promise<RunRepairActivityOutput> {
  const result = await runRepair({
    projectId: input.projectId,
    userId: input.userId,
    reportId: input.reportId,
    attempt: input.attempt,
  });

  return {
    changed: result.changed,
    reportId: input.reportId,
    executionId: result.executionId,
    nodeId: result.nodeId,
    filesChanged: result.filesChanged,
    summary: result.summary,
  };
}
