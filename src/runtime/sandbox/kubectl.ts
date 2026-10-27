import { spawn } from "node:child_process";

export const KUBECTL_OUTPUT_CAP = 512_000;

export interface KubectlResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface KubectlRunOptions {
  timeoutMs?: number;
  input?: string;
  capBytes?: number;
}

function kubectlBinary(): string {
  return process.env.DOABLE_KUBECTL ?? "kubectl";
}

function appendCapped(
  chunks: Buffer[],
  total: number,
  chunk: Buffer,
  cap: number,
): number {
  if (total >= cap) return total;
  const remaining = cap - total;
  chunks.push(chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk);
  return total + Math.min(chunk.byteLength, remaining);
}

/**
 * Run kubectl without a host shell. Output is capped so a runaway build log
 * cannot grow the Next.js heap or the verification report.
 */
export function runKubectl(
  args: readonly string[],
  options: KubectlRunOptions = {},
): Promise<KubectlResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const cap = options.capBytes ?? KUBECTL_OUTPUT_CAP;
  const started = Date.now();

  return new Promise((resolve) => {
    const child = spawn(kubectlBinary(), [...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes = appendCapped(stdout, stdoutBytes, chunk, cap);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes = appendCapped(stderr, stderrBytes, chunk, cap);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        code: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: error.message,
        timedOut,
        durationMs: Date.now() - started,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        durationMs: Date.now() - started,
      });
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

/** Copy a host directory into an existing pod volume without a host shell. */
export async function copyDirectoryIntoPod(input: {
  namespace: string;
  podName: string;
  container: string;
  sourceDir: string;
  destination: string;
  timeoutMs: number;
}): Promise<KubectlResult> {
  const started = Date.now();
  const timeoutMs = input.timeoutMs;

  return new Promise((resolve) => {
    const tar = spawn("tar", ["-C", input.sourceDir, "-cf", "-", "."], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const kubectl = spawn(
      kubectlBinary(),
      [
        "exec",
        "-i",
        "-n",
        input.namespace,
        input.podName,
        "-c",
        input.container,
        "--",
        "tar",
        "-xf",
        "-",
        "-C",
        input.destination,
      ],
      { stdio: ["pipe", "pipe", "pipe"], env: process.env },
    );

    const stderr: Buffer[] = [];
    let timedOut = false;
    let settled = false;

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({
        code,
        stdout: "",
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        durationMs: Date.now() - started,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      tar.kill("SIGKILL");
      kubectl.kill("SIGKILL");
    }, timeoutMs);

    tar.stdout.pipe(kubectl.stdin);
    tar.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    kubectl.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    tar.on("error", (error) => {
      clearTimeout(timer);
      stderr.push(Buffer.from(error.message));
      finish(null);
    });
    kubectl.on("error", (error) => {
      clearTimeout(timer);
      stderr.push(Buffer.from(error.message));
      finish(null);
    });
    kubectl.on("close", (code) => {
      clearTimeout(timer);
      finish(code);
    });
  });
}
