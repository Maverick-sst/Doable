import { ProjectStatus, VerificationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getTemporalClient, getTemporalTaskQueue } from "@/src/temporal/client";
import {
  buildVerificationWorkflowId,
  type VerificationWorkflowInput,
} from "@/src/temporal/contracts/verification";
import { verificationWorkflow } from "@/src/temporal/workflows/verificationWorkflow";
import { VERIFICATION_WORKFLOW_TIMEOUT } from "@/src/temporal/workflow-timeouts";
import { resolveRepairMaxAttempts } from "@/src/runtime/budgets";

export class VerificationStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationStartError";
  }
}

export interface StartVerificationInput {
  projectId: string;
  userId: string;
  executionId?: string | null;
  nodeId?: string | null;
  keepPreview?: boolean;
}

export interface StartVerificationResult {
  report: NonNullable<
    Awaited<ReturnType<typeof prisma.verificationReport.findUnique>>
  >;
  temporalWorkflowId: string | null;
}

/**
 * The only verification-start boundary. Creates the RUNNING report the UI
 * polls, then hands execution to Temporal. A missing worker leaves an honest
 * BLOCKED report instead of a fake PASSED.
 */
export async function startVerification(
  input: StartVerificationInput,
): Promise<StartVerificationResult> {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: input.userId, archivedAt: null },
    select: { id: true, status: true },
  });
  if (!project) throw new VerificationStartError("Project not found");
  if (project.status === ProjectStatus.IN_PROGRESS) {
    throw new VerificationStartError(
      "Wait for the build to finish before verifying",
    );
  }

  const staleCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const active = await prisma.verificationReport.findFirst({
    where: {
      projectId: input.projectId,
      status: VerificationStatus.RUNNING,
      createdAt: { gt: staleCutoff },
    },
    select: { id: true },
  });
  if (active) {
    throw new VerificationStartError("A verification run is already active");
  }

  const maxAttempts = resolveRepairMaxAttempts();
  const report = await prisma.verificationReport.create({
    data: {
      projectId: input.projectId,
      executionId: input.executionId ?? null,
      nodeId: input.nodeId ?? null,
      status: VerificationStatus.RUNNING,
      command: "sandbox",
      attempt: 1,
      steps: [],
      evidence: {
        orchestration: { provider: "temporal", maxAttempts },
      },
    },
  });

  if (process.env.SANDBOX_ENABLED === "false") {
    const blocked = await prisma.verificationReport.update({
      where: { id: report.id },
      data: {
        status: VerificationStatus.BLOCKED,
        exitCode: 1,
        output: "Sandbox verification is disabled (SANDBOX_ENABLED=false)",
      },
    });
    return { report: blocked, temporalWorkflowId: null };
  }

  const workflowInput: VerificationWorkflowInput = {
    projectId: input.projectId,
    userId: input.userId,
    reportId: report.id,
    executionId: input.executionId ?? null,
    nodeId: input.nodeId ?? null,
    initialAttempt: 1,
    maxAttempts,
    keepPreview: input.keepPreview ?? true,
  };

  try {
    const client = getTemporalClient();
    const temporalWorkflowId = buildVerificationWorkflowId(report.id);
    await client.workflow.start(verificationWorkflow, {
      taskQueue: getTemporalTaskQueue(),
      workflowId: temporalWorkflowId,
      workflowExecutionTimeout: VERIFICATION_WORKFLOW_TIMEOUT,
      args: [workflowInput],
    });
    return { report, temporalWorkflowId };
  } catch {
    const blocked = await prisma.verificationReport.update({
      where: { id: report.id },
      data: {
        status: VerificationStatus.BLOCKED,
        exitCode: 1,
        output:
          "The verification worker is unavailable. Start Temporal and the worker, then retry.",
      },
    });
    return { report: blocked, temporalWorkflowId: null };
  }
}
