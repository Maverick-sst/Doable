/**
 * Disposable sandbox seam. The verification runtime depends on this interface
 * only; Kubernetes is one adapter, and a future local-container adapter can
 * replace it without touching verification or repair.
 */

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface PackageJsonShape {
  scripts?: Record<string, string>;
  packageManager?: string;
}

export type PreviewPlan =
  | { kind: "script"; command: string; port: number }
  | { kind: "static"; command: string; port: number }
  | null;

export interface PackagePlan {
  packageManager: PackageManager;
  install: string;
  build: string | null;
  test: string | null;
  preview: PreviewPlan;
}

export interface SandboxAvailability {
  available: boolean;
  reason?: string;
}

export interface SandboxCreateOptions {
  /** Short stable suffix used in the namespace/pod name. */
  runId: string;
  /** Host directory whose contents become /workspace. */
  sourceDir: string;
}

export interface SandboxExecOptions {
  timeoutMs: number;
  env?: Record<string, string>;
}

export interface SandboxExecResult {
  exitCode: number;
  output: string;
  timedOut: boolean;
  durationMs: number;
}

export interface SandboxPreview {
  url: string;
  /** Stops the port-forward, not the in-pod server. */
  stop(): Promise<void>;
}

export interface SandboxHandle {
  id: string;
  namespace: string;
  podName: string;
  exec(command: string, options: SandboxExecOptions): Promise<SandboxExecResult>;
  startPreview(plan: PreviewPlan, timeoutMs: number): Promise<SandboxPreview | null>;
  destroy(): Promise<void>;
}

export interface SandboxAdapter {
  readonly kind: string;
  available(): Promise<SandboxAvailability>;
  create(options: SandboxCreateOptions): Promise<SandboxHandle>;
}
