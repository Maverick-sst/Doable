import { VerificationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  listWorkspaceFiles,
  syncProjectWorkspace,
} from "@/src/runtime/workspace";

export interface StructuralCheckResult {
  status: VerificationStatus;
  command: string;
  exitCode: number;
  durationMs: number;
  output: string;
  revision: string | null;
}

/**
 * V1 verification is deliberately honest: it checks the persistent workspace
 * structure and reports that build/test execution is not run. A future
 * sandbox adapter will replace the `NOT_RUN` branch with real commands and
 * exit codes.
 */
export async function runStructuralVerification(
  projectId: string,
): Promise<StructuralCheckResult> {
  const started = Date.now();
  await syncProjectWorkspace(projectId);
  const files = await listWorkspaceFiles(projectId);
  const hasPackageJson = files.includes("package.json");
  const hasSource = files.some(
    (file) => file.startsWith("src/") || file.startsWith("app/"),
  );

  const status =
    files.length > 0 && hasSource
      ? VerificationStatus.PASSED
      : VerificationStatus.BLOCKED;
  const output = JSON.stringify(
    {
      kind: "structure-check",
      fileCount: files.length,
      hasPackageJson,
      hasSource,
      buildOrTests: "not_run",
      note: "Build/test execution requires the disposable sandbox adapter.",
    },
    null,
    2,
  );

  return {
    status,
    command: "doable-structure-check",
    exitCode: status === VerificationStatus.PASSED ? 0 : 1,
    durationMs: Date.now() - started,
    output,
    revision: `${files.length} files`,
  };
}

export async function recordVerification(input: {
  projectId: string;
  executionId?: string | null;
  nodeId?: string | null;
  result: StructuralCheckResult;
}) {
  return prisma.verificationReport.create({
    data: {
      projectId: input.projectId,
      executionId: input.executionId ?? null,
      nodeId: input.nodeId ?? null,
      status: input.result.status,
      command: input.result.command,
      exitCode: input.result.exitCode,
      durationMs: input.result.durationMs,
      output: input.result.output,
      revision: input.result.revision,
    },
  });
}

export async function latestVerification(projectId: string) {
  return prisma.verificationReport.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
}