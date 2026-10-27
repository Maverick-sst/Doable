import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import {
  copyDirectoryIntoPod,
  runKubectl,
} from "./kubectl";
import type {
  SandboxAdapter,
  SandboxAvailability,
  SandboxCreateOptions,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxHandle,
  SandboxPreview,
  PreviewPlan,
} from "./types";

const CONTAINER_NAME = "workspace";
const POD_NAME = "workspace";
const READY_TIMEOUT_MS = 120_000;

export class SandboxError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
  }
}

function intFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sandboxImage(): string {
  return process.env.SANDBOX_IMAGE ?? "doable-sandbox:latest";
}

function namespaceFor(runId: string): string {
  const safe = runId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return `doable-${safe || "run"}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function environmentPrefix(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
}

function namespaceManifest(namespace: string, runId: string) {
  return {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
      name: namespace,
      labels: { "app.kubernetes.io/part-of": "doable", "doable.ai/run": runId },
    },
  };
}

/**
 * Default-deny egress with only DNS and public HTTP(S) allowed. Cluster,
 * private, link-local, CGNAT, and loopback ranges are excluded so a generated
 * app cannot reach the host, the metadata service, or the local network.
 * Public internet is intentionally reachable for package installs.
 */
function networkPolicyManifest(namespace: string) {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "sandbox-egress", namespace },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress", "Egress"],
      ingress: [],
      egress: [
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "kube-system" },
              },
              podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
            },
          ],
          ports: [
            { protocol: "UDP", port: 53 },
            { protocol: "TCP", port: 53 },
          ],
        },
        {
          to: [
            {
              ipBlock: {
                cidr: "0.0.0.0/0",
                except: [
                  "10.0.0.0/8",
                  "100.64.0.0/10",
                  "127.0.0.0/8",
                  "169.254.0.0/16",
                  "172.16.0.0/12",
                  "192.168.0.0/16",
                ],
              },
            },
          ],
          ports: [
            { protocol: "TCP", port: 80 },
            { protocol: "TCP", port: 443 },
          ],
        },
      ],
    },
  };
}

function podManifest(namespace: string, runId: string) {
  const deadline = intFromEnv("SANDBOX_DEADLINE_SECONDS", 1_800);
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: POD_NAME,
      namespace,
      labels: { app: "doable-sandbox", "doable.ai/run": runId },
    },
    spec: {
      restartPolicy: "Never",
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      terminationGracePeriodSeconds: 3,
      activeDeadlineSeconds: deadline,
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 1000,
        runAsGroup: 1000,
        fsGroup: 1000,
        seccompProfile: { type: "RuntimeDefault" },
      },
      containers: [
        {
          name: CONTAINER_NAME,
          image: sandboxImage(),
          imagePullPolicy: "IfNotPresent",
          command: ["sleep", "infinity"],
          workingDir: "/workspace",
          env: [
            { name: "HOME", value: "/home/sandbox" },
            { name: "TMPDIR", value: "/tmp" },
            { name: "CI", value: "1" },
            { name: "NEXT_TELEMETRY_DISABLED", value: "1" },
            { name: "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", value: "1" },
            { name: "COREPACK_ENABLE_DOWNLOAD_PROMPT", value: "0" },
            { name: "DO_NOT_TRACK", value: "1" },
            { name: "npm_config_update_notifier", value: "false" },
          ],
          ports: [{ name: "preview", containerPort: 4173 }],
          resources: {
            requests: { cpu: "100m", memory: "128Mi" },
            limits: {
              cpu: process.env.SANDBOX_CPU_LIMIT ?? "1",
              memory: process.env.SANDBOX_MEMORY_LIMIT ?? "1Gi",
            },
          },
          securityContext: {
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            capabilities: { drop: ["ALL"] },
          },
          volumeMounts: [
            { name: "workspace", mountPath: "/workspace" },
            { name: "tmp", mountPath: "/tmp" },
            { name: "home", mountPath: "/home/sandbox" },
          ],
        },
      ],
      volumes: [
        { name: "workspace", emptyDir: { sizeLimit: "512Mi" } },
        { name: "tmp", emptyDir: { sizeLimit: "512Mi" } },
        { name: "home", emptyDir: { sizeLimit: "256Mi" } },
      ],
    },
  };
}

async function applyManifest(
  manifest: unknown,
  timeoutMs: number,
): Promise<void> {
  const result = await runKubectl(["apply", "-f", "-"], {
    input: JSON.stringify(manifest),
    timeoutMs,
  });
  if (result.code !== 0) {
    throw new SandboxError(
      "apply_failed",
      `kubectl apply failed: ${(result.stderr || result.stdout).slice(0, 800)}`,
    );
  }
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a preview port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url: string, timeoutMs: number, child: ChildProcess) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new SandboxError(
        "preview_forward_exited",
        `Preview port-forward exited (${child.exitCode})`,
      );
    }
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(3_000),
      });
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new SandboxError(
    "preview_unavailable",
    `Preview did not become reachable: ${lastError.slice(0, 300)}`,
  );
}

class KubernetesHandle implements SandboxHandle {
  readonly id: string;
  readonly namespace: string;
  readonly podName: string;
  private preview: SandboxPreview | null = null;

  constructor(id: string, namespace: string) {
    this.id = id;
    this.namespace = namespace;
    this.podName = POD_NAME;
  }

  async exec(
    command: string,
    options: SandboxExecOptions,
  ): Promise<SandboxExecResult> {
    const prefix = environmentPrefix({
      CI: "1",
      HOST: "0.0.0.0",
      PORT: "4173",
      ...options.env,
    });
    const result = await runKubectl(
      [
        "exec",
        "-n",
        this.namespace,
        this.podName,
        "-c",
        CONTAINER_NAME,
        "--",
        "sh",
        "-lc",
        `${prefix} ${command}`,
      ],
      { timeoutMs: options.timeoutMs },
    );

    const output = [result.stdout, result.stderr]
      .filter((part) => part.trim().length > 0)
      .join("\n")
      .slice(0, KUBECTL_EXEC_OUTPUT_CAP);

    return {
      exitCode: result.code ?? (result.timedOut ? 124 : 1),
      output,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    };
  }

  async startPreview(
    plan: PreviewPlan,
    timeoutMs: number,
  ): Promise<SandboxPreview | null> {
    if (!plan) return null;

    const started = await this.exec(
      `nohup sh -lc ${shellQuote(plan.command)} >/tmp/doable-preview.log 2>&1 </dev/null & echo $!`,
      { timeoutMs: 15_000 },
    );
    if (started.exitCode !== 0) {
      throw new SandboxError(
        "preview_start_failed",
        `Preview server did not start: ${started.output.slice(0, 500)}`,
      );
    }

    const port = await getFreePort();
    const child = spawn(
      process.env.DOABLE_KUBECTL ?? "kubectl",
      [
        "port-forward",
        "-n",
        this.namespace,
        `pod/${this.podName}`,
        `127.0.0.1:${port}:${plan.port}`,
      ],
      { stdio: ["ignore", "pipe", "pipe"], env: process.env },
    );

    const url = `http://127.0.0.1:${port}/`;
    try {
      await waitForHttp(url, timeoutMs, child);
    } catch (error) {
      child.kill("SIGKILL");
      throw error;
    }

    const stop = async () => {
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (child.exitCode === null) child.kill("SIGKILL");
    };

    this.preview = { url, stop };
    return this.preview;
  }

  async destroy(): Promise<void> {
    if (this.preview) {
      await this.preview.stop().catch(() => undefined);
      this.preview = null;
    }
    await runKubectl(
      [
        "delete",
        "namespace",
        this.namespace,
        "--ignore-not-found",
        "--wait=true",
        "--timeout=90s",
      ],
      { timeoutMs: 120_000 },
    ).catch(() => undefined);
  }
}

const KUBECTL_EXEC_OUTPUT_CAP = intFromEnv(
  "SANDBOX_OUTPUT_CAP_BYTES",
  200_000,
);

export class KubernetesSandboxAdapter implements SandboxAdapter {
  readonly kind = "kubernetes";

  async available(): Promise<SandboxAvailability> {
    if (process.env.SANDBOX_ENABLED === "false") {
      return { available: false, reason: "SANDBOX_ENABLED=false" };
    }

    const client = await runKubectl(["version", "--client", "-o", "json"], {
      timeoutMs: 5_000,
    });
    if (client.code !== 0) {
      return {
        available: false,
        reason: `kubectl is unavailable: ${(client.stderr || "not found").slice(0, 300)}`,
      };
    }

    const cluster = await runKubectl(["get", "namespaces"], {
      timeoutMs: 10_000,
    });
    if (cluster.code !== 0) {
      return {
        available: false,
        reason: `Kubernetes cluster is not reachable: ${(cluster.stderr || cluster.stdout).slice(0, 300)}`,
      };
    }

    return { available: true };
  }

  async create(options: SandboxCreateOptions): Promise<SandboxHandle> {
    const namespace = namespaceFor(options.runId);
    const handle = new KubernetesHandle(options.runId, namespace);

    try {
      await applyManifest(
        namespaceManifest(namespace, options.runId),
        30_000,
      );
      await applyManifest(networkPolicyManifest(namespace), 30_000);
      await applyManifest(podManifest(namespace, options.runId), 30_000);

      const ready = await runKubectl(
        [
          "wait",
          "--for=condition=Ready",
          `pod/${POD_NAME}`,
          "-n",
          namespace,
          `--timeout=${Math.round(READY_TIMEOUT_MS / 1000)}s`,
        ],
        { timeoutMs: READY_TIMEOUT_MS + 10_000 },
      );
      if (ready.code !== 0) {
        const pod = await runKubectl(
          ["get", "pod", POD_NAME, "-n", namespace, "-o", "json"],
          { timeoutMs: 10_000 },
        );
        throw new SandboxError(
          "pod_not_ready",
          `Sandbox pod did not become ready: ${(
            pod.stderr || ready.stderr || ready.stdout
          ).slice(0, 800)}`,
        );
      }

      const copied = await copyDirectoryIntoPod({
        namespace,
        podName: POD_NAME,
        container: CONTAINER_NAME,
        sourceDir: options.sourceDir,
        destination: "/workspace",
        timeoutMs: 120_000,
      });
      if (copied.code !== 0) {
        throw new SandboxError(
          "copy_failed",
          `Could not copy the workspace into the sandbox: ${copied.stderr.slice(0, 800)}`,
        );
      }

      return handle;
    } catch (error) {
      await handle.destroy();
      throw error;
    }
  }
}
