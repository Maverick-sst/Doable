import { ArtifactType, NodeStatus, NodeType, WorkflowStatus, WorkflowType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { executeNode } from "@/src/cognition/node-executor";
import type { NodeConfig } from "@/src/cognition/types/node-config";
import { AGENT_DEFINITIONS } from "@/src/hcr/agent-config";
import { readWorkspaceSnapshot, listWorkspaceFiles } from "@/src/runtime/workspace";
import { snapshotHash } from "@/src/runtime/verification/runner";
import {
  completeExecution,
  completeExecutionPartially,
  failExecution,
} from "@/src/runtime/state/transitions";

export interface RepairRunInput {
  projectId: string;
  userId: string;
  reportId: string;
  attempt: number;
}

export interface RepairRunResult {
  changed: boolean;
  executionId: string;
  nodeId: string;
  filesChanged: string[];
  summary: string;
}

interface ReportStep {
  name?: string;
  status?: string;
  command?: string | null;
  exitCode?: number | null;
  output?: string;
}

function tail(value: unknown, limit = 6_000): string {
  if (typeof value !== "string") return "";
  return value.length > limit ? `…${value.slice(-limit)}` : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function buildEvidencePrompt(input: {
  reportId: string;
  attempt: number;
  steps: ReportStep[];
  evidence: Record<string, unknown>;
  fileTree: string[];
}): string {
  const failedSteps = input.steps.filter(
    (step) => step.status === "failed" || step.status === "timed_out",
  );
  const stepText = failedSteps
    .map(
      (step) =>
        `Step: ${step.name ?? "unknown"} (${step.status ?? "unknown"})\n` +
        `Command: ${step.command ?? "(none)"}\n` +
        `Exit: ${step.exitCode ?? "n/a"}\n` +
        `Output tail:\n${tail(step.output) || "(empty)"}`,
    )
    .join("\n\n");

  const browser = asRecord(input.evidence.browser);
  const browserLines = [
    `available: ${String(browser.available ?? false)}`,
    `reason: ${String(browser.reason ?? "(none)")}`,
    `url: ${String(browser.url ?? "(none)")}`,
    `title: ${String(browser.title ?? "(none)")}`,
    `httpStatus: ${String(browser.httpStatus ?? "n/a")}`,
    `consoleErrors: ${JSON.stringify(browser.consoleErrors ?? []).slice(0, 3_000)}`,
    `pageErrors: ${JSON.stringify(browser.pageErrors ?? []).slice(0, 3_000)}`,
    `failedRequests: ${JSON.stringify(browser.failedRequests ?? []).slice(0, 3_000)}`,
    `httpErrors: ${JSON.stringify(browser.httpErrors ?? []).slice(0, 2_000)}`,
  ].join("\n");
  const dom = typeof browser.domSnapshot === "string"
    ? tail(browser.domSnapshot, 6_000)
    : "(unavailable)";

  return `Verification attempt ${input.attempt} failed for this project.

Report: ${input.reportId}

${stepText || "No failed command step; the preview or browser probe failed."}

Browser probe:
${browserLines}

DOM snapshot tail:
${dom}

Workspace files (paths only):
${input.fileTree.slice(0, 800).join("\n")}

Make the smallest source fix that addresses the evidence. Read files before editing. Do not edit package.json scripts, tests, lockfiles, or verification evidence. If the evidence is insufficient, make no change and call mark_complete with your reasoning.`;
}

function repairNodeConfig(): NodeConfig {
  const definition = AGENT_DEFINITIONS.REPAIR_ENG;
  return {
    nodeType: NodeType.REPAIR,
    outputArtifactType: null,
    consumedArtifactTypes: [
      ArtifactType.APPROVED_PRD,
      ArtifactType.EXECUTION_PLAN,
    ],
    systemPrompt: definition.instructions,
    contextConfig: {
      consumedArtifactTypes: [
        ArtifactType.APPROVED_PRD,
        ArtifactType.EXECUTION_PLAN,
      ],
      includeFileTree: true,
      includeVectorSearch: true,
      includeMessageHistory: false,
    },
    usesFileTools: true,
    maxIterations: 40,
    outputMode: "tool_calls",
  };
}

function changedFiles(
  before: Array<{ path: string; checksum: string }>,
  after: Array<{ path: string; checksum: string }>,
): string[] {
  const previous = new Map(before.map((file) => [file.path, file.checksum]));
  const changed: string[] = [];
  for (const file of after) {
    if (previous.get(file.path) !== file.checksum) changed.push(file.path);
  }
  for (const file of before) {
    if (!after.some((candidate) => candidate.path === file.path)) {
      changed.push(file.path);
    }
  }
  return changed.sort().slice(0, 200);
}

/**
 * One bounded repair pass. Repair runs as its own REPAIR workflow/execution so
 * the original build execution keeps its completed state. The verification
 * report links the repair evidence; only a fresh verification can pass.
 */
export async function runRepair(input: RepairRunInput): Promise<RepairRunResult> {
  const report = await prisma.verificationReport.findFirst({
    where: { id: input.reportId, projectId: input.projectId },
  });
  if (!report) throw new Error("Verification report not found");

  const before = await readWorkspaceSnapshot(input.projectId);
  const beforeHash = snapshotHash(before);
  const steps = Array.isArray(report.steps) ? (report.steps as ReportStep[]) : [];
  const evidence = asRecord(report.evidence);
  const fileTree = await listWorkspaceFiles(input.projectId);

  const created = await prisma.$transaction(async (tx) => {
    const workflow = await tx.workflow.create({
      data: {
        projectId: input.projectId,
        type: WorkflowType.REPAIR,
        status: WorkflowStatus.RUNNING,
      },
    });
    const execution = await tx.execution.create({
      data: { workflowId: workflow.id },
    });
    const order = await tx.node.count({ where: { executionId: execution.id } });
    const node = await tx.node.create({
      data: {
        executionId: execution.id,
        type: NodeType.REPAIR,
        status: NodeStatus.CREATED,
        order: order + 1,
      },
    });
    await tx.runtimeEvent.createMany({
      data: [
        {
          executionId: execution.id,
          type: "workflow.created",
          payload: { workflowId: workflow.id, type: WorkflowType.REPAIR },
        },
        {
          executionId: execution.id,
          type: "execution.created",
          payload: { executionId: execution.id, type: WorkflowType.REPAIR },
        },
        {
          executionId: execution.id,
          nodeId: node.id,
          type: "node.created",
          payload: { nodeId: node.id, type: NodeType.REPAIR, order: order + 1 },
        },
      ],
    });
    return { workflowId: workflow.id, executionId: execution.id, nodeId: node.id };
  });

  const prompt = buildEvidencePrompt({
    reportId: report.id,
    attempt: input.attempt,
    steps,
    evidence,
    fileTree,
  });

  let summary = "Repair node failed before producing changes";
  let incomplete = false;
  try {
    const result = await executeNode({
      projectId: input.projectId,
      userId: input.userId,
      workflowId: created.workflowId,
      executionId: created.executionId,
      nodeId: created.nodeId,
      prompt,
      nodeConfig: repairNodeConfig(),
      attempt: 1,
    });
    incomplete = result.incomplete;
    summary = result.incomplete
      ? "Repair stopped on its iteration budget"
      : "Repair node completed";
  } catch {
    await failExecution({
      projectId: input.projectId,
      workflowId: created.workflowId,
      executionId: created.executionId,
      nodeId: created.nodeId,
      reason: "Repair node failed",
      code: "provider_error",
    });
    await prisma.verificationReport.update({
      where: { id: report.id },
      data: {
        evidence: {
          ...evidence,
          repair: {
            executionId: created.executionId,
            nodeId: created.nodeId,
            changed: false,
            summary,
          },
        },
      },
    });
    return {
      changed: false,
      executionId: created.executionId,
      nodeId: created.nodeId,
      filesChanged: [],
      summary,
    };
  }

  const after = await readWorkspaceSnapshot(input.projectId);
  const afterHash = snapshotHash(after);
  const changed = beforeHash !== afterHash;
  const files = changedFiles(before, after);

  if (incomplete) {
    await completeExecutionPartially({
      projectId: input.projectId,
      workflowId: created.workflowId,
      executionId: created.executionId,
      reason: "Repair stopped on budget",
    });
  } else {
    await completeExecution({
      projectId: input.projectId,
      workflowId: created.workflowId,
      executionId: created.executionId,
    });
  }

  await prisma.verificationReport.update({
    where: { id: report.id },
    data: {
      evidence: {
        ...evidence,
        repair: {
          executionId: created.executionId,
          nodeId: created.nodeId,
          changed,
          filesChanged: files,
          summary,
        },
      },
    },
  });

  return {
    changed,
    executionId: created.executionId,
    nodeId: created.nodeId,
    filesChanged: files,
    summary,
  };
}
