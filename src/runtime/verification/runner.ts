import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Prisma, VerificationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  readWorkspaceSnapshot,
  syncProjectWorkspace,
  type WorkspaceSnapshotFile,
} from "@/src/runtime/workspace";
import {
  getSandboxAdapter,
  planVerification,
  type PackagePlan,
  type SandboxHandle,
  type SandboxPreview,
} from "@/src/runtime/sandbox";
import { SandboxError } from "@/src/runtime/sandbox/kubernetes";
import { captureBrowserEvidence, type BrowserEvidence } from "./evidence";

export type VerificationStepStatus =
  | "passed"
  | "failed"
  | "skipped"
  | "timed_out";

export interface VerificationStep {
  name: "install" | "build" | "test" | "preview" | "browser";
  command: string | null;
  status: VerificationStepStatus;
  exitCode: number | null;
  durationMs: number;
  output: string;
  required: boolean;
}

export interface RunVerificationOptions {
  /** Update this pre-created RUNNING report. When absent a report is created. */
  reportId?: string;
  executionId?: string | null;
  nodeId?: string | null;
  attempt?: number;
  parentReportId?: string | null;
  /** Keep the preview port-forward alive after a successful probe. */
  keepPreview?: boolean;
}

export interface VerificationRunResult {
  reportId: string;
  status: VerificationStatus;
  previewUrl: string | null;
  snapshotHash: string;
  steps: VerificationStep[];
  evidence: Record<string, unknown>;
}

const PREVIEW_TTL_MS = 30 * 60 * 1000;

function intFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function snapshotHash(files: WorkspaceSnapshotFile[]): string {
  return createHash("sha256")
    .update(
      [...files]
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .map((file) => `${file.path}\t${file.checksum}\t${file.size}`)
        .join("\n"),
    )
    .digest("hex");
}

async function stageSnapshot(
  files: WorkspaceSnapshotFile[],
): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "doable-sandbox-"));
  for (const file of files) {
    const target = path.resolve(directory, file.path);
    if (!target.startsWith(`${directory}${path.sep}`)) {
      throw new Error(`Unsafe workspace path: ${file.path}`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  return directory;
}

function summarizeOutput(steps: VerificationStep[]): string {
  return steps
    .map((step) => {
      const exit = step.exitCode === null ? "" : ` exit=${step.exitCode}`;
      return `${step.name}: ${step.status}${exit} (${step.durationMs}ms)`;
    })
    .join("\n")
    .slice(0, 20_000);
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function updateReport(
  reportId: string,
  data: Prisma.VerificationReportUncheckedUpdateInput,
): Promise<void> {
  await prisma.verificationReport.update({ where: { id: reportId }, data });
}

async function runStep(input: {
  sandbox: SandboxHandle;
  name: VerificationStep["name"];
  command: string;
  timeoutMs: number;
  required: boolean;
  env?: Record<string, string>;
}): Promise<VerificationStep> {
  const result = await input.sandbox.exec(input.command, {
    timeoutMs: input.timeoutMs,
    env: input.env,
  });
  const status: VerificationStepStatus = result.timedOut
    ? "timed_out"
    : result.exitCode === 0
      ? "passed"
      : "failed";
  return {
    name: input.name,
    command: input.command,
    status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    output: result.output,
    required: input.required,
  };
}

function resultStatus(steps: VerificationStep[]): VerificationStatus {
  const requiredFailures = steps.filter(
    (step) =>
      step.required &&
      (step.status === "failed" || step.status === "timed_out"),
  );
  if (requiredFailures.some((step) => step.status === "timed_out")) {
    return VerificationStatus.TIMED_OUT;
  }
  if (requiredFailures.length > 0) return VerificationStatus.FAILED;
  if (steps.every((step) => step.status === "skipped")) {
    return VerificationStatus.BLOCKED;
  }
  return VerificationStatus.PASSED;
}

function infraFailure(error: unknown): boolean {
  if (!(error instanceof SandboxError)) return false;
  return [
    "apply_failed",
    "pod_not_ready",
    "copy_failed",
    "preview_forward_exited",
  ].includes(error.code);
}

/**
 * Real verification: copy the canonical workspace into a disposable pod,
 * install/build/test with project scripts only, probe the preview in a
 * browser, and persist bounded evidence. Never claims a command ran when the
 * sandbox was unavailable.
 */
export async function runSandboxVerification(
  projectId: string,
  options: RunVerificationOptions = {},
): Promise<VerificationRunResult> {
  const started = Date.now();
  await syncProjectWorkspace(projectId);

  const snapshot = await readWorkspaceSnapshot(projectId);
  if (snapshot.length === 0) {
    return finishBlocked(projectId, options, "Workspace is empty");
  }

  const hash = snapshotHash(snapshot);
  const reportId =
    options.reportId ??
    (
      await prisma.verificationReport.create({
        data: {
          projectId,
          executionId: options.executionId ?? null,
          nodeId: options.nodeId ?? null,
          status: VerificationStatus.RUNNING,
          command: "sandbox",
          revision: hash,
          snapshotHash: hash,
          attempt: options.attempt ?? 1,
          parentReportId: options.parentReportId ?? null,
          steps: jsonValue([]),
          evidence: jsonValue({}),
        },
        select: { id: true },
      })
    ).id;

  await updateReport(reportId, {
    status: VerificationStatus.RUNNING,
    command: "sandbox",
    revision: hash,
    snapshotHash: hash,
    attempt: options.attempt ?? 1,
    parentReportId: options.parentReportId ?? null,
  });

  const steps: VerificationStep[] = [];
  const evidence: Record<string, unknown> = {
    snapshot: { fileCount: snapshot.length, hash },
  };

  const adapter = getSandboxAdapter();
  const availability = await adapter.available();
  if (!availability.available) {
    return finishBlocked(
      projectId,
      { ...options, reportId },
      availability.reason ?? "Sandbox unavailable",
      steps,
      evidence,
      hash,
    );
  }

  const packageFile = snapshot.find((file) => file.path === "package.json");
  if (!packageFile) {
    return finishBlocked(
      projectId,
      { ...options, reportId },
      "package.json is missing; there is no build to verify",
      steps,
      evidence,
      hash,
    );
  }

  let pkg: { scripts?: Record<string, string>; packageManager?: string };
  try {
    pkg = JSON.parse(packageFile.content.toString("utf8")) as typeof pkg;
  } catch {
    return finishBlocked(
      projectId,
      { ...options, reportId },
      "package.json is not valid JSON",
      steps,
      evidence,
      hash,
    );
  }

  const files = snapshot.map((file) => file.path);
  const plan: PackagePlan = planVerification(pkg, files);
  evidence.plan = plan;

  let staging: string | null = null;
  let sandbox: SandboxHandle | null = null;
  let preview: SandboxPreview | null = null;
  let keepSandbox = false;

  try {
    staging = await stageSnapshot(snapshot);
    sandbox = await adapter.create({ runId: reportId, sourceDir: staging });
    evidence.sandbox = {
      kind: adapter.kind,
      namespace: sandbox.namespace,
      pod: sandbox.podName,
    };

    const install = await runStep({
      sandbox,
      name: "install",
      command: plan.install,
      timeoutMs: intFromEnv("SANDBOX_INSTALL_TIMEOUT_MS", 600_000),
      required: true,
      env: {
        NPM_CONFIG_AUDIT: "false",
        NPM_CONFIG_FUND: "false",
        YARN_ENABLE_TELEMETRY: "0",
        BUN_INSTALL_CACHE_DIR: "/tmp/bun-cache",
      },
    });
    steps.push(install);

    if (plan.build) {
      steps.push(
        await runStep({
          sandbox,
          name: "build",
          command: plan.build,
          timeoutMs: intFromEnv("SANDBOX_BUILD_TIMEOUT_MS", 600_000),
          required: true,
        }),
      );
    } else {
      steps.push({
        name: "build",
        command: null,
        status: "skipped",
        exitCode: null,
        durationMs: 0,
        output: "No build script in package.json",
        required: false,
      });
    }

    if (plan.test) {
      steps.push(
        await runStep({
          sandbox,
          name: "test",
          command: plan.test,
          timeoutMs: intFromEnv("SANDBOX_TEST_TIMEOUT_MS", 600_000),
          required: true,
        }),
      );
    } else {
      steps.push({
        name: "test",
        command: null,
        status: "skipped",
        exitCode: null,
        durationMs: 0,
        output: "No test script in package.json",
        required: false,
      });
    }

    if (plan.preview) {
      const previewStartedAt = Date.now();
      try {
        preview = await sandbox.startPreview(
          plan.preview,
          intFromEnv("SANDBOX_PREVIEW_TIMEOUT_MS", 45_000),
        );
      } catch (error) {
        steps.push({
          name: "preview",
          command: plan.preview.command,
          status: "failed",
          exitCode: null,
          durationMs: Date.now() - previewStartedAt,
          output:
            error instanceof Error ? error.message.slice(0, 4_000) : "Preview failed",
          required: true,
        });
        throw error;
      }

      steps.push({
        name: "preview",
        command: plan.preview.command,
        status: preview ? "passed" : "failed",
        exitCode: preview ? 0 : 1,
        durationMs: Date.now() - previewStartedAt,
        output: preview ? `Preview reachable at ${preview.url}` : "Preview unavailable",
        required: true,
      });

      if (preview) {
        const browser: BrowserEvidence = await captureBrowserEvidence({
          projectId,
          runId: reportId,
          previewUrl: preview.url,
          timeoutMs: intFromEnv("SANDBOX_BROWSER_TIMEOUT_MS", 45_000),
        });
        evidence.browser = browser;
        const browserFailed =
          browser.available && (browser.httpStatus ?? 0) >= 500;
        steps.push({
          name: "browser",
          command: null,
          status: !browser.available
            ? "skipped"
            : browserFailed
              ? "failed"
              : "passed",
          exitCode: !browser.available ? null : browserFailed ? 1 : 0,
          durationMs: browser.durationMs,
          output: browser.available
            ? `${browser.screenshotUrl ?? "no screenshot"} title=${browser.title ?? ""}`
            : (browser.reason ?? "Browser evidence unavailable"),
          required: false,
        });
      }
    } else {
      steps.push({
        name: "preview",
        command: null,
        status: "skipped",
        exitCode: null,
        durationMs: 0,
        output: "No preview/start script and no static build directory",
        required: false,
      });
    }

    const status = resultStatus(steps);
    evidence.preview = {
      planned: Boolean(plan.preview),
      url: preview?.url ?? null,
      kept: Boolean(preview && (options.keepPreview ?? true)),
    };
    evidence.durationMs = Date.now() - started;

    const firstFailure = steps.find(
      (step) => step.status === "failed" || step.status === "timed_out",
    );

    await updateReport(reportId, {
      status,
      command: steps
        .map((step) => step.command)
        .filter((command): command is string => Boolean(command))
        .join(" && ")
        .slice(0, 4_000) || "sandbox",
      exitCode: firstFailure?.exitCode ?? 0,
      durationMs: Date.now() - started,
      output: summarizeOutput(steps),
      steps: jsonValue(steps),
      evidence: jsonValue(evidence),
      previewUrl: preview?.url ?? null,
    });

    keepSandbox = Boolean(preview && (options.keepPreview ?? true));
    if (keepSandbox) {
      const handle = sandbox;
      const timer = setTimeout(() => {
        void handle.destroy();
      }, PREVIEW_TTL_MS);
      timer.unref?.();
    }

    return {
      reportId,
      status,
      previewUrl: preview?.url ?? null,
      snapshotHash: hash,
      steps,
      evidence,
    };
  } catch (error) {
    const blocked = infraFailure(error);
    const message = error instanceof Error ? error.message : String(error);
    evidence.error = { kind: blocked ? "sandbox" : "verification", message: message.slice(0, 2_000) };
    evidence.durationMs = Date.now() - started;

    await updateReport(reportId, {
      status: blocked ? VerificationStatus.BLOCKED : VerificationStatus.FAILED,
      command: steps
        .map((step) => step.command)
        .filter((command): command is string => Boolean(command))
        .join(" && ")
        .slice(0, 4_000) || "sandbox",
      exitCode: 1,
      durationMs: Date.now() - started,
      output: `${summarizeOutput(steps)}\n${message.slice(0, 4_000)}`.trim(),
      steps: jsonValue(steps),
      evidence: jsonValue(evidence),
    });

    return {
      reportId,
      status: blocked ? VerificationStatus.BLOCKED : VerificationStatus.FAILED,
      previewUrl: preview?.url ?? null,
      snapshotHash: hash,
      steps,
      evidence,
    };
  } finally {
    if (!keepSandbox) await preview?.stop().catch(() => undefined);
    if (staging) await rm(staging, { recursive: true, force: true });
    if (sandbox && !keepSandbox) await sandbox.destroy();
  }
}

async function finishBlocked(
  projectId: string,
  options: RunVerificationOptions,
  reason: string,
  steps: VerificationStep[] = [],
  evidence: Record<string, unknown> = {},
  hash = "",
): Promise<VerificationRunResult> {
  const reportId = options.reportId;
  const data = {
    status: VerificationStatus.BLOCKED,
    command: "sandbox",
    revision: hash || null,
    snapshotHash: hash || null,
    exitCode: 1,
    durationMs: 0,
    output: reason,
    steps: jsonValue(steps),
    evidence: jsonValue({ ...evidence, error: { kind: "blocked", message: reason } }),
  };

  if (reportId) {
    await updateReport(reportId, data);
    return {
      reportId,
      status: VerificationStatus.BLOCKED,
      previewUrl: null,
      snapshotHash: hash,
      steps,
      evidence,
    };
  }

  const report = await prisma.verificationReport.create({
    data: {
      projectId,
      executionId: options.executionId ?? null,
      nodeId: options.nodeId ?? null,
      attempt: options.attempt ?? 1,
      parentReportId: options.parentReportId ?? null,
      ...data,
    },
    select: { id: true },
  });
  return {
    reportId: report.id,
    status: VerificationStatus.BLOCKED,
    previewUrl: null,
    snapshotHash: hash,
    steps,
    evidence,
  };
}


