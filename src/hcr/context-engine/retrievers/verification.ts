import { prisma } from "@/lib/prisma";
import type { VerificationContext } from "../types";

/** Bounded log slice; verification output can be large. */
export const VERIFICATION_OUTPUT_CHARS = 1200;
export const DEFAULT_VERIFICATION_LIMIT = 3;

/**
 * Most recent verification reports for a project. A report is marked stale
 * when a workspace file changed after the report was produced, because its
 * evidence no longer describes the current revision.
 */
export async function retrieveVerificationReports(
  projectId: string,
  limit: number = DEFAULT_VERIFICATION_LIMIT,
): Promise<VerificationContext[]> {
  const [reports, latestFile] = await Promise.all([
    prisma.verificationReport.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Math.max(1, limit),
      select: {
        id: true,
        status: true,
        command: true,
        exitCode: true,
        durationMs: true,
        output: true,
        revision: true,
        createdAt: true,
      },
    }),
    prisma.file.findFirst({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);

  const latestFileUpdate = latestFile?.updatedAt ?? null;

  return reports.map((report) => ({
    id: report.id,
    status: report.status,
    command: report.command,
    exitCode: report.exitCode,
    durationMs: report.durationMs,
    outputSnippet: report.output
      ? report.output.slice(0, VERIFICATION_OUTPUT_CHARS)
      : null,
    revision: report.revision,
    createdAt: report.createdAt.toISOString(),
    stale: latestFileUpdate !== null && report.createdAt < latestFileUpdate,
  }));
}
