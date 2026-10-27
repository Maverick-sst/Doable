"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Spinner,
  statusTone,
} from "@/components/ui";

type LinkState = {
  owner: string;
  repo: string;
  defaultBranch: string;
  htmlUrl: string;
  updatedAt: string;
} | null;

type PushRecord = {
  id: string;
  status: string;
  branch: string;
  baseBranch: string;
  commitSha: string | null;
  pullRequestUrl: string | null;
  errorCode: string | null;
  stats: {
    additions?: number;
    updates?: number;
    deletions?: number;
    files?: number;
  } | null;
  createdAt: string;
};

type State = {
  configured: boolean;
  encryptionConfigured: boolean;
  envTokenConfigured: boolean;
  connection: { login: string; tokenLast4: string } | null;
  link: LinkState;
  pushes: PushRecord[];
};

type Preview = {
  pushId: string;
  branch: string;
  baseBranch: string;
  manifestHash: string;
  stats: {
    additions: number;
    updates: number;
    deletions: number;
    files: number;
  };
  plan: {
    additions: string[];
    updates: string[];
    deletions: string[];
  };
};

export function GitHubPanel({ projectId }: { projectId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [allowDeletions, setAllowDeletions] = useState(false);
  const [createPullRequest, setCreatePullRequest] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/github`, {
      cache: "no-store",
    });
    const data = (await response.json()) as State & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Could not load GitHub");
    setState(data);
    if (data.link) {
      setOwner(data.link.owner);
      setRepo(data.link.repo);
      setBranch(data.link.defaultBranch);
    }
  }, [projectId]);

  useEffect(() => {
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Load failed"),
    );
  }, [load]);

  async function mutate(
    path: string,
    init: RequestInit,
    success: string,
    refresh = true,
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(path, init);
      const data = (await response.json()) as {
        error?: string;
        preview?: Preview;
      };
      if (!response.ok) throw new Error(data.error ?? "Request failed");
      setNotice(success);
      if (data.preview) setPreview(data.preview);
      if (refresh) await load();
      return data;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function link() {
    setPreview(null);
    await mutate(
      `/api/projects/${projectId}/github`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo, branch: branch || undefined }),
      },
      "Repository linked.",
    );
  }

  async function unlink() {
    setPreview(null);
    await mutate(
      `/api/projects/${projectId}/github`,
      { method: "DELETE" },
      "Repository unlinked.",
    );
  }

  async function runPreview() {
    await mutate(
      `/api/projects/${projectId}/github/push`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      "Preview ready. Nothing has been pushed yet.",
      false,
    );
  }

  async function confirm() {
    if (!preview) return;
    const data = await mutate(
      `/api/projects/${projectId}/github/push/${preview.pushId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifestHash: preview.manifestHash,
          allowDeletions,
          createPullRequest,
        }),
      },
      "Push completed.",
      false,
    );
    if (data) {
      setPreview(null);
      await load().catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Refresh failed"),
      );
    }
  }

  async function cancelPreview() {
    if (!preview) return;
    await mutate(
      `/api/projects/${projectId}/github/push/${preview.pushId}`,
      { method: "DELETE" },
      "Preview cancelled.",
      false,
    );
    setPreview(null);
  }

  if (!state) {
    return (
      <Card>
        <CardBody>
          <Spinner label="Loading GitHub" />
        </CardBody>
      </Card>
    );
  }

  const disabled = busy || !state.configured;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <Card>
          <CardHeader
            title="Repository"
            description="Agents can read this repository. Nothing is written until you confirm a push."
            action={
              state.link ? (
                <Badge tone="success">linked</Badge>
              ) : (
                <Badge tone="warning">not linked</Badge>
              )
            }
          />
          <CardBody className="space-y-3 text-sm">
            {!state.configured ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                Add a GitHub token in Settings before linking a repository.
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Owner">
                <Input
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                  placeholder="octocat"
                />
              </Field>
              <Field label="Repository">
                <Input
                  value={repo}
                  onChange={(event) => setRepo(event.target.value)}
                  placeholder="hello-world"
                />
              </Field>
            </div>
            <Field
              label="Base branch"
              hint="Leave blank for the repository default. The default branch itself is never written."
            >
              <Input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="main"
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void link()}
                disabled={disabled || !owner.trim() || !repo.trim()}
              >
                {state.link ? "Update link" : "Link repository"}
              </Button>
              {state.link ? (
                <Button
                  variant="danger"
                  onClick={() => void unlink()}
                  disabled={busy}
                >
                  Unlink
                </Button>
              ) : null}
              {state.link ? (
                <a
                  href={state.link.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  Open {state.link.owner}/{state.link.repo}
                </a>
              ) : null}
            </div>
          </CardBody>
        </Card>

        {state.link ? (
          <Card>
            <CardHeader
              title="Push workspace"
              description="Preview the exact file diff, then confirm. Deletions are excluded unless you opt in."
              action={<Badge tone="info">{state.link.defaultBranch}</Badge>}
            />
            <CardBody className="space-y-3 text-sm">
              {!preview ? (
                <Button onClick={() => void runPreview()} disabled={busy}>
                  {busy ? "Preparing..." : "Preview push"}
                </Button>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <Stat label="Added" value={preview.stats.additions} />
                    <Stat label="Updated" value={preview.stats.updates} />
                    <Stat label="Deleted" value={preview.stats.deletions} />
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Push to <code>{preview.branch}</code> from{" "}
                    <code>{preview.baseBranch}</code>. A new branch is created
                    on confirm.
                  </p>
                  <details className="rounded border border-zinc-200 p-3 text-xs dark:border-zinc-800">
                    <summary className="cursor-pointer text-zinc-600 dark:text-zinc-300">
                      Changed paths
                    </summary>
                    <PathList title="Added" paths={preview.plan.additions} />
                    <PathList title="Updated" paths={preview.plan.updates} />
                    <PathList title="Deleted" paths={preview.plan.deletions} />
                  </details>
                  <label className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={allowDeletions}
                      onChange={(event) => setAllowDeletions(event.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Allow deleting {preview.stats.deletions} remote file(s)
                      that are absent from the workspace.
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={createPullRequest}
                      onChange={(event) =>
                        setCreatePullRequest(event.target.checked)
                      }
                      className="mt-0.5"
                    />
                    <span>Open a pull request against the base branch.</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void confirm()} disabled={busy}>
                      {busy ? "Pushing..." : "Confirm push"}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void cancelPreview()}
                      disabled={busy}
                    >
                      Cancel preview
                    </Button>
                  </div>
                </>
              )}
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                The workspace is snapshotted again on confirm. If any file
                changed after preview, the push is refused and you must preview
                again.
              </p>
            </CardBody>
          </Card>
        ) : null}
      </div>

      <Card className="h-fit">
        <CardHeader title="Recent pushes" description="Latest 10 attempts." />
        <CardBody className="space-y-3 text-xs">
          {error ? (
            <p className="text-rose-600 dark:text-rose-400">{error}</p>
          ) : null}
          {notice ? (
            <p className="text-emerald-600 dark:text-emerald-400">{notice}</p>
          ) : null}
          {state.pushes.length === 0 ? (
            <p className="text-zinc-500 dark:text-zinc-400">No pushes yet.</p>
          ) : (
            state.pushes.map((push) => (
              <div
                key={push.id}
                className="space-y-1 border-t border-zinc-200 pt-2 first:border-0 first:pt-0 dark:border-zinc-800"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={statusTone(push.status)}>{push.status}</Badge>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {new Date(push.createdAt).toLocaleString()}
                  </span>
                </div>
                <code className="block truncate text-[11px]">{push.branch}</code>
                {push.stats ? (
                  <p className="text-zinc-500 dark:text-zinc-400">
                    +{push.stats.additions ?? 0} · ~{push.stats.updates ?? 0} · −
                    {push.stats.deletions ?? 0}
                  </p>
                ) : null}
                {push.errorCode ? (
                  <p className="text-rose-600 dark:text-rose-400">
                    {push.errorCode}
                  </p>
                ) : null}
                {push.pullRequestUrl ? (
                  <a
                    href={push.pullRequestUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    Pull request
                  </a>
                ) : null}
              </div>
            ))
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-zinc-500 dark:text-zinc-400">{label}</div>
    </div>
  );
}

function PathList({ title, paths }: { title: string; paths: string[] }) {
  if (paths.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="font-medium">{title}</p>
      <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
        {paths.slice(0, 50).map((path) => (
          <li key={path} className="truncate font-mono text-[11px]">
            {path}
          </li>
        ))}
      </ul>
    </div>
  );
}
