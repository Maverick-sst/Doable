"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
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