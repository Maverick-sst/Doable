"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "./app-shell";
import { GitHubPanel } from "./github-panel";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  Spinner,
  Textarea,
  cn,
  statusTone,
} from "./ui";

type Message = {
  id: string;
  role: string;
  content: string;
  phase: string;
  createdAt: string;
};

type ProjectDetail = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  workspacePath: string | null;
  files: FileMeta[];
  messages: Message[];
};

type FileMeta = {
  id: string;
  path: string;
  size: number | null;
  revision: number;
  updatedAt: string;
};

type FileDetail = FileMeta & {
  content: string;
  checksum: string | null;
  createdAt: string;
};

type NodeState = {
  id: string;
  type: string;
  status: string;
  order: number;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  failureReason: string | null;
};

type StatusResponse = {
  status: string;
  failureReason: string | null;
  build: {
    workflowId: string;
    status: string;
    createdAt: string;
    execution: {
      id: string;
      status: string;
      failureReason: string | null;
      temporalWorkflowId: string | null;
      startedAt: string | null;
      finishedAt: string | null;
      artifactCount: number;
      nodes: NodeState[];
    } | null;
  } | null;
  discovery: {
    workflowId: string;
    status: string;
    createdAt: string;
    execution: { id: string; status: string } | null;
  } | null;
};

type Artifact = {
  id: string;
  type: string;
  version: number;
  schemaVersion: number;
  validationStatus: string;
  contentHash: string | null;
  producedBy: string;
  content: unknown;
  createdAt: string;
  workflowId: string;
  executionId: string | null;
  nodeId: string | null;
};

type HcrEvent = {
  id: string;
  type: string;
  payload: unknown;
  nodeId: string | null;
  createdAt: string;
};

type HcrState = {
  workflow: { id: string; type: string; status: string } | null;
  execution: { id: string; status: string; createdAt: string } | null;
  nodes: NodeState[];
  artifacts: Artifact[];
  events: HcrEvent[];
};

type VerificationStep = {
  name: string;
  status: string;
  command: string | null;
  exitCode: number | null;
  durationMs: number;
  output: string;
  required: boolean;
};

type Verification = {
  id: string;
  status: string;
  command: string | null;
  exitCode: number | null;
  durationMs: number | null;
  output: string | null;
  revision: string | null;
  snapshotHash: string | null;
  previewUrl: string | null;
  steps: VerificationStep[] | null;
  evidence: Record<string, unknown> | null;
  parentReportId: string | null;
  attempt: number;
  createdAt: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

type Tab = "discovery" | "build" | "artifacts" | "files" | "github";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "discovery", label: "Discovery" },
  { id: "build", label: "Build" },
  { id: "artifacts", label: "Artifacts" },
  { id: "files", label: "Files" },
  { id: "github", label: "GitHub" },
];

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [hcr, setHcr] = useState<HcrState | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [verificationAttempts, setVerificationAttempts] = useState<
    Array<{ id: string; status: string; attempt: number; createdAt: string }>
  >([]);
  const [tab, setTab] = useState<Tab>("discovery");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [discoveryPrompt, setDiscoveryPrompt] = useState("");
  const [buildPrompt, setBuildPrompt] = useState(
    "Build the approved project. Create the scaffold and implement the execution plan.",
  );
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileDetail | null>(null);
  const [fileDraft, setFileDraft] = useState("");
  const [newPath, setNewPath] = useState("");
  const [newContent, setNewContent] = useState("");
  const [fileBusy, setFileBusy] = useState(false);

  const load = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      try {
        const [
          projectResponse,
          statusResponse,
          hcrResponse,
          artifactsResponse,
          filesResponse,
          verificationResponse,
        ] = await Promise.all([
          fetch(`/api/projects/${projectId}`, { cache: "no-store" }),
          fetch(`/api/projects/${projectId}/status`, { cache: "no-store" }),
          fetch(`/api/projects/${projectId}/hcr`, { cache: "no-store" }),
          fetch(`/api/projects/${projectId}/artifacts`, { cache: "no-store" }),
          fetch(`/api/projects/${projectId}/files`, { cache: "no-store" }),
          fetch(`/api/projects/${projectId}/verifications`, { cache: "no-store" }),
        ]);

        if (!projectResponse.ok) {
          throw new Error("Project not found");
        }

        const projectData = (await projectResponse.json()) as {
          project: ProjectDetail;
        };
        const statusData = (await statusResponse.json()) as StatusResponse;
        const hcrData = (await hcrResponse.json()) as HcrState;
        const artifactsData = (await artifactsResponse.json()) as {
          artifacts: Artifact[];
        };
        const filesData = (await filesResponse.json()) as { files: FileMeta[] };
        const verificationData = (await verificationResponse.json()) as {
          verification: Verification | null;
          attempts?: Array<{
            id: string;
            status: string;
            attempt: number;
            createdAt: string;
          }>;
        };

        setProject(projectData.project);
        setStatus(statusData);
        setHcr(hcrData);
        setArtifacts(artifactsData.artifacts ?? []);
        setFiles(filesData.files ?? []);
        setVerification(verificationData.verification ?? null);
        setVerificationAttempts(verificationData.attempts ?? []);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load project");
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const activeStatus = status?.status ?? project?.status ?? "UNKNOWN";
  const isRunning = activeStatus === "IN_PROGRESS";

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      void load(false);
    }, 2000);
    return () => clearInterval(timer);
  }, [isRunning, load]);

  const verificationRunning = verification?.status === "RUNNING";

  useEffect(() => {
    if (!verificationRunning) return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/projects/${projectId}/verifications`,
            { cache: "no-store" },
          );
          if (!response.ok) return;
          const data = (await response.json()) as {
            verification: Verification | null;
            attempts?: Array<{
              id: string;
              status: string;
              attempt: number;
              createdAt: string;
            }>;
          };
          setVerification(data.verification ?? null);
          setVerificationAttempts(data.attempts ?? []);
        } catch {
          // Keep the last known state; the next poll retries.
        }
      })();
    }, 3000);
    return () => clearInterval(timer);
  }, [projectId, verificationRunning]);

  const discoveryMessages = useMemo(
    () => (project?.messages ?? []).filter((message) => message.phase === "DISCOVERY"),
    [project],
  );
  const discoveryArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.type === "DISCOVERY_REQUIREMENT"),
    [artifacts],
  );
  const buildArtifacts = useMemo(
    () => artifacts.filter((artifact) => artifact.type !== "DISCOVERY_REQUIREMENT"),
    [artifacts],
  );
  const evidence = record(verification?.evidence);
  const browserEvidence = record(evidence.browser);
  const repairEvidence = record(evidence.repair);
  const screenshotUrl =
    typeof browserEvidence.screenshotUrl === "string"
      ? browserEvidence.screenshotUrl
      : null;

  async function sendDiscovery(event: React.FormEvent) {
    event.preventDefault();
    if (!discoveryPrompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/discovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: discoveryPrompt }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Discovery failed");
      setDiscoveryPrompt("");
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Discovery failed");
    } finally {
      setBusy(false);
    }
  }

  async function startBuild(event: React.FormEvent) {
    event.preventDefault();
    if (!buildPrompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: buildPrompt }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not start build");
      setTab("build");
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start build");
    } finally {
      setBusy(false);
    }
  }

  async function retryBuild() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/retry`, {
        method: "POST",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Retry failed");
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Retry failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancelBuild() {
    if (!window.confirm("Cancel the active build?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/cancel`, {
        method: "POST",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Cancel failed");
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  }

  async function runVerification() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/verifications`, {
        method: "POST",
      });
      const data = (await response.json()) as {
        verification?: Verification;
        error?: string;
      };
      if (!response.ok || !data.verification) {
        throw new Error(data.error ?? "Verification failed");
      }
      setVerification(data.verification);
      if (data.verification.status === "RUNNING") {
        setVerificationAttempts((previous) => {
          if (previous.some((attempt) => attempt.id === data.verification?.id)) {
            return previous;
          }
          return [
            {
              id: data.verification!.id,
              status: data.verification!.status,
              attempt: data.verification!.attempt,
              createdAt: data.verification!.createdAt,
            },
            ...previous,
          ];
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  async function openFile(file: FileMeta) {
    setFileBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/files/${file.id}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as { file?: FileDetail; error?: string };
      if (!response.ok || !data.file) {
        throw new Error(data.error ?? "Could not read file");
      }
      setSelectedFile(data.file);
      setFileDraft(data.file.content);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read file");
    } finally {
      setFileBusy(false);
    }
  }

  async function saveFile() {
    if (!selectedFile) return;
    setFileBusy(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/files/${selectedFile.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: fileDraft }),
        },
      );
      const data = (await response.json()) as { file?: FileDetail; error?: string };
      if (!response.ok || !data.file) {
        throw new Error(data.error ?? "Could not save file");
      }
      setSelectedFile(data.file);
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save file");
    } finally {
      setFileBusy(false);
    }
  }

  async function createFile(event: React.FormEvent) {
    event.preventDefault();
    if (!newPath.trim()) return;
    setFileBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: newPath, content: newContent }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not create file");
      setNewPath("");
      setNewContent("");
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create file");
    } finally {
      setFileBusy(false);
    }
  }

  async function deleteFile(file: FileMeta) {
    if (!window.confirm(`Delete ${file.path}?`)) return;
    setFileBusy(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/files/${file.id}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Could not delete file");
      if (selectedFile?.id === file.id) {
        setSelectedFile(null);
        setFileDraft("");
      }
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete file");
    } finally {
      setFileBusy(false);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <Card>
          <CardBody>
            <Spinner label="Loading workspace" />
          </CardBody>
        </Card>
      </AppShell>
    );
  }

  if (!project) {
    return (
      <AppShell>
        <EmptyState
          title="Project unavailable"
          description={error ?? "The project could not be loaded."}
          action={
            <Link href="/dashboard">
              <Button>Back to projects</Button>
            </Link>
          }
        />
      </AppShell>
    );
  }

  const buildExecution = status?.build?.execution ?? null;
  const nodes = buildExecution?.nodes ?? hcr?.nodes ?? [];

  return (
    <AppShell>
      <div className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10.5px]">
              <Link
                href="/dashboard"
                className="text-faint transition-colors hover:text-ink"
              >
                Projects
              </Link>
              <span className="text-line-strong">/</span>
              <span className="text-muted">Workspace</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-[24px] font-semibold tracking-[-0.035em] text-ink">
                {project.name}
              </h1>
              <Badge tone={statusTone(activeStatus)}>{activeStatus}</Badge>
            </div>
            <p className="mt-1.5 max-w-2xl text-[12px] leading-5 text-muted">
              {project.description || "No description yet."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/projects/${projectId}/export`}>
              <Button variant="secondary">Export ZIP</Button>
            </a>
            {isRunning ? (
              <Button
                variant="danger"
                onClick={() => void cancelBuild()}
                disabled={busy}
              >
                Cancel build
              </Button>
            ) : null}
            {activeStatus === "FAILED" ? (
              <Button onClick={() => void retryBuild()} disabled={busy}>
                Retry
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-danger-line bg-danger-soft px-3.5 py-2.5 text-[12px] text-danger">
          {error}
        </div>
      ) : null}

      {status?.failureReason || buildExecution?.failureReason ? (
        <div className="mb-4 rounded-lg border border-warning-line bg-warning-soft px-3.5 py-2.5 text-[12px] text-warning">
          <strong className="font-semibold">Build stopped: </strong>
          {buildExecution?.failureReason ?? status?.failureReason}
        </div>
      ) : null}

      <div className="mb-5 flex items-center gap-1 overflow-x-auto border-b border-line">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? "page" : undefined}
            className={cn(
              "-mb-px flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[12px] font-medium transition-colors",
              tab === item.id
                ? "border-ink text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {item.label}
            {item.id === "artifacts" ? (
              <span className="rounded bg-hover px-1 py-0.5 text-[9px] tabular-nums text-faint">
                {artifacts.length}
              </span>
            ) : null}
            {item.id === "files" ? (
              <span className="rounded bg-hover px-1 py-0.5 text-[9px] tabular-nums text-faint">
                {files.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "discovery" ? (
        <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="min-w-0">
            <CardHeader
              title="Discovery"
              description="The agent asks one focused question at a time. Nothing is built until you approve."
            />
            <CardBody className="space-y-4">
              <div className="max-h-[440px] space-y-3 overflow-y-auto rounded-lg border border-line bg-rail/50 p-3">
                {discoveryMessages.length === 0 ? (
                  <EmptyState
                    title="Describe the idea"
                    description="Start with what you want to exist, who it is for, and what must be true when it works."
                  />
                ) : (
                  discoveryMessages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        "max-w-[82%] rounded-xl px-3.5 py-2.5 text-[12.5px] leading-6",
                        message.role === "USER"
                          ? "ml-auto rounded-br-md bg-accent text-accent-foreground"
                          : "rounded-bl-md border border-line bg-canvas text-ink shadow-sm",
                      )}
                    >
                      {message.content}
                    </div>
                  ))
                )}
              </div>
              <form className="space-y-2" onSubmit={sendDiscovery}>
                <Textarea
                  value={discoveryPrompt}
                  onChange={(event) => setDiscoveryPrompt(event.target.value)}
                  rows={3}
                  placeholder={
                    activeStatus === "DISCOVERY"
                      ? "Answer the agent or add constraints..."
                      : "Discovery is closed for this project."
                  }
                  disabled={activeStatus !== "DISCOVERY" || busy}
                />
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] text-faint">
                    {activeStatus === "DISCOVERY"
                      ? "Discovery writes a versioned requirements artifact."
                      : "Requirements are approved; open the Build tab."}
                  </span>
                  <Button
                    type="submit"
                    disabled={activeStatus !== "DISCOVERY" || busy || !discoveryPrompt.trim()}
                  >
                    {busy ? "Sending..." : "Send"}
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>

          <Card className="h-fit min-w-0">
            <CardHeader title="Requirements" description="Latest approved artifact." />
            <CardBody className="space-y-3">
              {discoveryArtifact ? (
                <>
                  <div className="flex items-center justify-between">
                    <Badge tone="success">v{discoveryArtifact.version}</Badge>
                    <span className="text-[11px] text-faint">
                      {new Date(discoveryArtifact.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <pre className="max-h-[360px] overflow-auto rounded-lg border border-line bg-code p-3 text-[10.5px] leading-5 text-code-foreground">
                    {pretty(discoveryArtifact.content)}
                  </pre>
                  {activeStatus === "PENDING" ? (
                    <Button className="w-full" onClick={() => setTab("build")}>
                      Approve & Build
                    </Button>
                  ) : null}
                </>
              ) : (
                <p className="text-[11.5px] leading-5 text-muted">
                  No requirements artifact yet. Finish discovery first.
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "build" ? (
        <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-5">
            <Card>
              <CardHeader
                title="Build"
                description="Discovery must be approved. The graph runs through Temporal."
              />
              <CardBody className="space-y-4">
                {activeStatus === "PENDING" || activeStatus === "IDLE" ? (
                  <form className="space-y-2" onSubmit={startBuild}>
                    <Textarea
                      value={buildPrompt}
                      onChange={(event) => setBuildPrompt(event.target.value)}
                      rows={3}
                    />
                    <div className="flex justify-end">
                      <Button type="submit" disabled={busy || !discoveryArtifact}>
                        {activeStatus === "IDLE" ? "Start iteration" : "Start build"}
                      </Button>
                    </div>
                  </form>
                ) : activeStatus === "DISCOVERY" ? (
                  <p className="text-sm text-muted">
                    Finish discovery and approve the requirements first.
                  </p>
                ) : activeStatus === "FAILED" ? (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-muted">
                      This run failed. Retry starts a new attempt from the same approved requirements.
                    </p>
                    <Button onClick={() => void retryBuild()} disabled={busy}>
                      Retry build
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Spinner label="Build is running" />
                    <span className="text-xs text-faint">
                      Polling every 2 seconds.
                    </span>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Node timeline"
                description="Architect → research → PRD → plan → frontend + backend."
              />
              <CardBody>
                {nodes.length === 0 ? (
                  <p className="text-xs text-muted">
                    No build nodes yet.
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {nodes.map((node) => (
                      <li key={node.id} className="flex items-start gap-3">
                        <span
                          className={cn(
                            "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                            node.status === "COMPLETED"
                              ? "bg-success"
                              : node.status === "RUNNING"
                                ? "animate-pulse bg-brand"
                                : node.status === "FAILED"
                                  ? "bg-danger"
                                  : "bg-line-strong ",
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{node.type}</span>
                            <Badge tone={statusTone(node.status)}>{node.status}</Badge>
                            <span className="text-[11px] text-faint">
                              order {node.order}
                              {node.attempt > 0 ? ` · attempt ${node.attempt}` : ""}
                            </span>
                          </div>
                          {node.failureReason ? (
                            <p className="mt-1 text-[11px] text-danger">
                              {node.failureReason}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="min-w-0 space-y-5">
            <Card>
              <CardHeader title="Run details" />
              <CardBody className="space-y-2 text-xs">
                <Row label="Workflow" value={status?.build?.workflowId ?? "—"} />
                <Row label="Execution" value={buildExecution?.id ?? "—"} />
                <Row
                  label="Temporal ID"
                  value={buildExecution?.temporalWorkflowId ?? "—"}
                />
                <Row label="Execution status" value={buildExecution?.status ?? "—"} />
                <Row
                  label="Artifacts"
                  value={String(buildExecution?.artifactCount ?? 0)}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Workspace check"
                description="Runs install, build, tests, and a live preview in a disposable Kubernetes sandbox. Failures get one bounded repair pass and a re-run."
                action={
                  <Button variant="secondary" onClick={() => void runVerification()} disabled={busy}>
                    Run
                  </Button>
                }
              />
              <CardBody className="space-y-2 text-xs">
                {verification ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted">Status</span>
                      <Badge tone={statusTone(verification.status)}>
                        {verification.status}
                      </Badge>
                    </div>
                    <Row label="Command" value={verification.command ?? "—"} />
                    <Row
                      label="Exit code"
                      value={verification.exitCode === null ? "—" : String(verification.exitCode)}
                    />
                    <Row
                      label="Duration"
                      value={verification.durationMs === null ? "—" : `${verification.durationMs} ms`}
                    />
                    <Row label="Attempt" value={String(verification.attempt)} />
                    {verificationAttempts.length > 1 ? (
                      <Row
                        label="History"
                        value={verificationAttempts
                          .map((attempt) => `${attempt.attempt}:${attempt.status}`)
                          .join(" ")}
                      />
                    ) : null}
                    <Row
                      label="Revision"
                      value={
                        verification.snapshotHash
                          ? verification.snapshotHash.slice(0, 12)
                          : verification.revision ?? "—"
                      }
                    />
                    {verification.steps && verification.steps.length > 0 ? (
                      <div className="space-y-1">
                        {verification.steps.map((step) => (
                          <div
                            key={`${verification.id}-${step.name}`}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="text-muted">
                              {step.name}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="text-faint">
                                {step.durationMs} ms
                              </span>
                              <Badge tone={statusTone(step.status.toUpperCase())}>
                                {step.status}
                              </Badge>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <pre className="max-h-40 overflow-auto rounded bg-code p-2 text-[10px] text-code-foreground">
                      {verification.output}
                    </pre>
                    {verification.parentReportId ? (
                      <p className="text-[10px] text-muted">
                        Re-verification after a repair attempt.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-muted">
                    No workspace check yet.
                  </p>
                )}
              </CardBody>
            </Card>

            {verification && (verification.previewUrl || screenshotUrl) ? (
              <Card>
                <CardHeader
                  title="Preview"
                  description="Served from the disposable sandbox. It stays available for 30 minutes after the run."
                  action={
                    verification.previewUrl ? (
                      <a
                        href={verification.previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] font-medium text-brand hover:underline"
                      >
                        Open
                      </a>
                    ) : null
                  }
                />
                <CardBody className="space-y-3">
                  {verification.previewUrl ? (
                    <iframe
                      src={verification.previewUrl}
                      title="Sandbox preview"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                      className="h-80 w-full rounded border border-line bg-white "
                    />
                  ) : null}
                  {screenshotUrl ? (
                    <Image
                      src={screenshotUrl}
                      alt="Screenshot captured during verification"
                      width={1280}
                      height={800}
                      unoptimized
                      className="w-full rounded border border-line"
                    />
                  ) : null}
                  {typeof browserEvidence.reason === "string" ? (
                    <p className="text-[10px] text-warning">
                      Visual evidence unavailable: {browserEvidence.reason}
                    </p>
                  ) : null}
                  {repairEvidence.changed === true ? (
                    <p className="text-[10px] text-muted">
                      Repair changed{" "}
                      {Array.isArray(repairEvidence.filesChanged)
                        ? repairEvidence.filesChanged.length
                        : 0}{" "}
                      file(s) before re-verification.
                    </p>
                  ) : null}
                </CardBody>
              </Card>
            ) : null}

            <Card>
              <CardHeader title="Recent events" />
              <CardBody>
                {(!hcr?.events || hcr.events.length === 0) ? (
                  <p className="text-xs text-muted">
                    No events yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {hcr.events.slice(-12).reverse().map((event) => (
                      <li key={event.id} className="text-[11px]">
                        <span className="font-mono text-muted">
                          {new Date(event.createdAt).toLocaleTimeString()}
                        </span>{" "}
                        <span className="text-ink">
                          {event.type}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "artifacts" ? (
        <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Card className="h-fit min-w-0">
            <CardHeader title="Artifacts" description="Immutable, versioned outputs." />
            <CardBody className="space-y-2">
              {artifacts.length === 0 ? (
                <p className="text-xs text-muted">
                  No artifacts yet.
                </p>
              ) : (
                artifacts.map((artifact) => (
                  <button
                    key={artifact.id}
                    onClick={() => setSelectedArtifact(artifact)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-left text-xs transition",
                      selectedArtifact?.id === artifact.id
                        ? "border-brand bg-accent-soft"
                        : "border-line hover:border-line-strong",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">{artifact.type}</span>
                      <Badge tone={artifact.type === "DISCOVERY_REQUIREMENT" ? "success" : "info"}>
                        v{artifact.version}
                      </Badge>
                    </span>
                    <span className="mt-1 block text-[11px] text-faint">
                      {artifact.producedBy} · {new Date(artifact.createdAt).toLocaleString()}
                    </span>
                  </button>
                ))
              )}
            </CardBody>
          </Card>

          <Card className="min-w-0">
            <CardHeader
              title={selectedArtifact?.type ?? "Select an artifact"}
              description={
                selectedArtifact
                  ? `Schema v${selectedArtifact.schemaVersion} · ${selectedArtifact.validationStatus} · ${selectedArtifact.contentHash?.slice(0, 12) ?? "no hash"}`
                  : "Choose an artifact to inspect its full content."
              }
            />
            <CardBody>
              {selectedArtifact ? (
                <pre className="max-h-[620px] overflow-auto rounded-lg bg-code p-4 text-[11px] leading-5 text-code-foreground">
                  {pretty(selectedArtifact.content)}
                </pre>
              ) : (
                <p className="text-xs text-muted">
                  Artifacts are the contract between cognitive stages.
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "github" ? (
        <GitHubPanel projectId={projectId} />
      ) : null}

      {tab === "files" ? (
        <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Card className="h-fit min-w-0">
            <CardHeader
              title="Workspace files"
              description="Filesystem-canonical, mirrored in Postgres."
            />
            <CardBody className="space-y-2">
              {files.length === 0 ? (
                <p className="text-xs text-muted">
                  No files yet. The build will create them.
                </p>
              ) : (
                <div className="max-h-[420px] space-y-0.5 overflow-y-auto pr-1">
                  {files.map((file) => (
                    <div key={file.id} className="flex items-center gap-1">
                      <button
                        onClick={() => void openFile(file)}
                        className={cn(
                          "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs",
                          selectedFile?.id === file.id
                            ? "bg-accent text-accent-foreground"
                            : "text-muted hover:bg-rail",
                        )}
                        title={file.path}
                      >
                        {file.path}
                      </button>
                      <button
                        onClick={() => void deleteFile(file)}
                        className="rounded px-1.5 py-1 text-[10px] text-danger hover:bg-danger-soft"
                        title="Delete file"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <form className="space-y-2 border-t border-line pt-3" onSubmit={createFile}>
                <Input
                  value={newPath}
                  onChange={(event) => setNewPath(event.target.value)}
                  placeholder="src/components/Button.tsx"
                />
                <Textarea
                  value={newContent}
                  onChange={(event) => setNewContent(event.target.value)}
                  rows={3}
                  placeholder="File content"
                />
                <Button type="submit" variant="secondary" className="w-full" disabled={fileBusy || !newPath.trim()}>
                  Add file
                </Button>
              </form>
            </CardBody>
          </Card>

          <Card className="min-w-0">
            <CardHeader
              title={selectedFile?.path ?? "Select a file"}
              description={
                selectedFile
                  ? `revision ${selectedFile.revision} · ${selectedFile.checksum?.slice(0, 12) ?? "no checksum"}`
                  : "Open a workspace file to view or edit it."
              }
              action={
                selectedFile ? (
                  <Button onClick={() => void saveFile()} disabled={fileBusy}>
                    {fileBusy ? "Saving..." : "Save"}
                  </Button>
                ) : null
              }
            />
            <CardBody>
              {selectedFile ? (
                <Textarea
                  value={fileDraft}
                  onChange={(event) => setFileDraft(event.target.value)}
                  className="min-h-[560px] font-mono text-xs leading-5"
                  spellCheck={false}
                />
              ) : (
                <p className="text-xs text-muted">
                  The workspace is the source of truth for generated code.
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {buildArtifacts.length > 0 && tab === "build" ? (
        <Card className="mt-5">
          <CardHeader title="Build artifacts" />
          <CardBody className="flex flex-wrap gap-2">
            {buildArtifacts.map((artifact) => (
              <button
                key={artifact.id}
                onClick={() => {
                  setSelectedArtifact(artifact);
                  setTab("artifacts");
                }}
                className="rounded-lg border border-line px-3 py-2 text-left text-xs hover:border-brand"
              >
                <span className="block font-medium">{artifact.type}</span>
                <span className="text-[11px] text-faint">v{artifact.version}</span>
              </button>
            ))}
          </CardBody>
        </Card>
      ) : null}
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="max-w-[220px] break-all text-right font-mono text-[11px] text-ink">
        {value}
      </span>
    </div>
  );
}