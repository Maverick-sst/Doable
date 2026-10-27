import { prisma } from "@/lib/prisma";

export {
  runSandboxVerification,
  snapshotHash,
  type RunVerificationOptions,
  type VerificationRunResult,
  type VerificationStep,
  type VerificationStepStatus,
} from "./runner";
export {
  captureBrowserEvidence,
  getEvidenceDir,
  getEvidenceRoot,
  isPrivateOrLocalHost,
  saveEvidenceScreenshot,
  type BrowserEvidence,
} from "./evidence";

const VERIFICATION_SELECT = {
  id: true,
  projectId: true,
  executionId: true,
  nodeId: true,
  status: true,
  command: true,
  exitCode: true,
  durationMs: true,
  output: true,
  revision: true,
  snapshotHash: true,
  previewUrl: true,
  steps: true,
  evidence: true,
  parentReportId: true,
  attempt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function latestVerification(projectId: string) {
  return prisma.verificationReport.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: VERIFICATION_SELECT,
  });
}

export async function listVerificationAttempts(projectId: string) {
  return prisma.verificationReport.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      status: true,
      attempt: true,
      snapshotHash: true,
      previewUrl: true,
      parentReportId: true,
      createdAt: true,
    },
  });
}

export async function latestPassingReport(
  projectId: string,
  snapshotHash?: string,
) {
  return prisma.verificationReport.findFirst({
    where: {
      projectId,
      status: "PASSED",
      ...(snapshotHash ? { snapshotHash } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, snapshotHash: true, previewUrl: true, createdAt: true },
  });
}
