"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { GitHubSettings } from "@/components/github-settings";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Spinner,
  statusTone,
} from "@/components/ui";

type Health = {
  database: { ok: boolean; error?: string };
  temporal: { ok: boolean; error?: string; host: string; taskQueue: string };
  workspaceRoot: string;
  authMode: string;
  provider: string;
  providerCapabilities: {
    chat: boolean;
    tools: boolean;
    embeddings: boolean;
  } | null;
  routing: {
    localOnly: boolean;
    modelId: string | null;
    providerId: string | null;
    model: string | null;
    locality: "local" | "remote" | null;
    reason: string | null;
    contextWindow: number | null;
    maxPromptTokens: number | null;
    candidates: Array<{
      id: string;
      eligible: boolean;
      reason: string;
    }>;
    error: string | null;
  };
  providerHealth: Array<{
    providerId: string;
    failures: number;
    open: boolean;
    openedAt: string | null;
  }>;
  cache: {
    enabled: boolean;
    hotEntries: number;
    namespaces: Array<{
      namespace: string;
      hits: number;
      misses: number;
      failures: number;
      writes: number;
      invalidations: number;
    }>;
  };
  timestamp: string;
};

export default function SettingsPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const data = (await response.json()) as Health;
        if (!cancelled) {
          setHealth(data);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Health check failed");
        }
      }
    }
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Local-first configuration. Secrets are read from the environment and
          never displayed here.
        </p>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Services" description="Live readiness checks." />
          <CardBody className="space-y-3 text-sm">
            {!health ? (
              <Spinner label="Checking services" />
            ) : (
              <>
                <ServiceRow
                  name="Postgres"
                  ok={health.database.ok}
                  detail={health.database.error}
                />
                <ServiceRow
                  name="Temporal"
                  ok={health.temporal.ok}
                  detail={
                    health.temporal.ok
                      ? `${health.temporal.host} · ${health.temporal.taskQueue}`
                      : health.temporal.error
                  }
                />
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600 dark:text-zinc-300">Auth mode</span>
                  <Badge tone="info">{health.authMode}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600 dark:text-zinc-300">Provider</span>
                  <Badge tone="info">{health.provider}</Badge>
                </div>
              </>
            )}
          </CardBody>
        </Card>

        <GitHubSettings />

        <Card>
          <CardHeader
            title="Local data"
            description="Where project metadata and generated files live."
          />
          <CardBody className="space-y-3 text-xs">
            <div>
              <p className="font-medium text-zinc-800 dark:text-zinc-200">
                Workspace root
              </p>
              <code className="mt-1 block break-all rounded bg-zinc-100 px-2 py-1 text-[11px] dark:bg-zinc-800">
                {health?.workspaceRoot ?? "loading..."}
              </code>
            </div>
            <p className="text-zinc-500 dark:text-zinc-400">
              Set <code>DOABLE_HOME</code> to move generated workspaces. The
              database stores metadata, messages, artifacts, and a content
              mirror; the workspace is the canonical editable copy.
            </p>
            <p className="text-zinc-500 dark:text-zinc-400">
              ZIP export excludes dependencies, caches, Git internals, and
              local environment files.
            </p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Model routing and egress"
            description="The live route the next model call would take, and whether local-only is enforced."
          />
          <CardBody className="space-y-3 text-xs">
            {!health ? (
              <Spinner label="Resolving route" />
            ) : health.routing.error ? (
              <>
                <Badge tone="danger">unroutable</Badge>
                <p className="break-words text-rose-600 dark:text-rose-400">
                  {health.routing.error}
                </p>
                <CandidateList candidates={health.routing.candidates} />
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-zinc-600 dark:text-zinc-300">Route</span>
                  <span className="flex items-center gap-2">
                    <Badge tone="info">{health.routing.modelId}</Badge>
                    <Badge
                      tone={
                        health.routing.locality === "local" ? "success" : "warning"
                      }
                    >
                      {health.routing.locality ?? "unknown"}
                    </Badge>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600 dark:text-zinc-300">Egress</span>
                  <Badge
                    tone={health.routing.localOnly ? "success" : "warning"}
                  >
                    {health.routing.localOnly
                      ? "local-only enforced"
                      : health.routing.locality === "remote"
                        ? "remote egress enabled"
                        : "local"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600 dark:text-zinc-300">
                    Prompt ceiling
                  </span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {health.routing.maxPromptTokens?.toLocaleString() ?? "unknown"}{" "}
                    of {health.routing.contextWindow?.toLocaleString() ?? "unknown"}{" "}
                    tokens
                  </span>
                </div>
                <CandidateList candidates={health.routing.candidates} />
                <div className="flex items-center justify-between border-t border-zinc-200 pt-3 dark:border-zinc-800">
                  <span className="text-zinc-600 dark:text-zinc-300">
                    Circuit breakers
                  </span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {health.providerHealth.length === 0
                      ? "all closed"
                      : health.providerHealth
                          .map(
                            (state) =>
                              `${state.providerId}: ${state.open ? "open" : `${state.failures} failure(s)`}`,
                          )
                          .join(" · ")}
                  </span>
                </div>
              </>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Derived cache"
            description="Scoped, versioned derived values. A cache failure falls through to the source, never to a wrong answer."
          />
          <CardBody className="space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-zinc-600 dark:text-zinc-300">State</span>
              <span className="flex items-center gap-2">
                <Badge tone={health?.cache.enabled ? "success" : "warning"}>
                  {health?.cache.enabled ? "enabled" : "disabled"}
                </Badge>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {health?.cache.hotEntries ?? 0} hot entries
                </span>
              </span>
            </div>
            {health && health.cache.namespaces.length > 0 ? (
              health.cache.namespaces.map((entry) => (
                <div
                  key={entry.namespace}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-2 dark:border-zinc-800"
                >
                  <span className="font-medium">{entry.namespace}</span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {entry.hits} hit(s) · {entry.misses} miss(es) ·{" "}
                    {entry.failures} failure(s) · {entry.writes} write(s)
                  </span>
                </div>
              ))
            ) : (
              <p className="text-zinc-500 dark:text-zinc-400">
                No lookups yet in this process.
              </p>
            )}
            <p className="text-zinc-500 dark:text-zinc-400">
              Keys are scoped by project, agent configuration, provider, and
              model version. Entries expire automatically and are invalidated
              when a project is deleted.
            </p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Model configuration"
            description="Choose a local model or an explicitly selected remote provider."
          />
          <CardBody className="grid gap-4 text-xs sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="text-sm font-semibold">Local (default)</h3>
              <p className="mt-1 text-zinc-500 dark:text-zinc-400">
                Point Doable at Ollama or any OpenAI-compatible local server.
                Nothing leaves the machine for inference.
              </p>
              <pre className="mt-3 overflow-x-auto rounded bg-zinc-950 p-3 text-[11px] text-zinc-100">{`MODEL_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2
OLLAMA_EMBEDDING_MODEL=nomic-embed-text`}</pre>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="text-sm font-semibold">Remote (OpenAI-compatible)</h3>
              <p className="mt-1 text-zinc-500 dark:text-zinc-400">
                Select the model explicitly. Only the context needed for that
                call is sent to the provider. RunAnywhere supports chat and
                tools but not embeddings, so semantic file search is skipped.
              </p>
              <pre className="mt-3 overflow-x-auto rounded bg-zinc-950 p-3 text-[11px] text-zinc-100">{`# RunAnywhere
MODEL_PROVIDER=runanywhere
RUNANYWHERE_API_KEY=...
MODEL=glm-5.3-flash

# OpenRouter
MODEL_PROVIDER=openrouter
OPENROUTER_API_KEY=...
MODEL=<selected open-weight model>`}</pre>
            </div>
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}

function CandidateList({
  candidates,
}: {
  candidates: Array<{ id: string; eligible: boolean; reason: string }>;
}) {
  if (candidates.length === 0) return null;
  return (
    <details className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <summary className="cursor-pointer text-zinc-600 dark:text-zinc-300">
        Candidate evaluation ({candidates.filter((c) => c.eligible).length}{" "}
        eligible)
      </summary>
      <ul className="mt-2 space-y-1">
        {candidates.slice(0, 8).map((candidate) => (
          <li
            key={candidate.id}
            className="flex items-center justify-between gap-2"
          >
            <code className="break-all text-[11px]">{candidate.id}</code>
            <Badge tone={candidate.eligible ? "success" : "neutral"}>
              {candidate.reason}
            </Badge>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ServiceRow({
  name,
  ok,
  detail,
}: {
  name: string;
  ok: boolean;
  detail?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-zinc-600 dark:text-zinc-300">{name}</span>
      <div className="max-w-[320px] text-right">
        <Badge tone={statusTone(ok ? "COMPLETED" : "FAILED")}>
          {ok ? "ready" : "unavailable"}
        </Badge>
        {!ok && detail ? (
          <p className="mt-1 break-words text-[11px] text-rose-600 dark:text-rose-400">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}