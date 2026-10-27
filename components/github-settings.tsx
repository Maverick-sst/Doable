"use client";

import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Spinner,
} from "@/components/ui";

type ConnectionState = {
  configured: boolean;
  encryptionConfigured: boolean;
  envTokenConfigured: boolean;
  connection: {
    login: string;
    tokenLast4: string;
    scopes: string | null;
    lastCheckedAt: string | null;
    updatedAt: string;
  } | null;
};

export function GitHubSettings() {
  const [state, setState] = useState<ConnectionState | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/github/connection", {
      cache: "no-store",
    });
    const data = (await response.json()) as ConnectionState & {
      error?: string;
    };
    if (!response.ok) throw new Error(data.error ?? "Could not load GitHub");
    setState(data);
  }

  useEffect(() => {
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Load failed"),
    );
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/github/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save token");
      setToken("");
      setNotice("GitHub token saved.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/github/connection", {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Could not remove GitHub token");
      setNotice("GitHub token removed.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="GitHub"
        description="Read-only repository context for agents, plus explicit workspace pushes."
        action={
          state ? (
            <Badge tone={state.configured ? "success" : "warning"}>
              {state.configured ? "configured" : "not configured"}
            </Badge>
          ) : null
        }
      />
      <CardBody className="space-y-3 text-sm">
        {!state ? (
          <Spinner label="Loading GitHub settings" />
        ) : (
          <>
            {state.connection ? (
              <div className="rounded-lg border border-line p-3 text-xs ">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{state.connection.login}</span>
                  <code>••••{state.connection.tokenLast4}</code>
                </div>
                <p className="mt-1 text-muted">
                  Stored encrypted. Scopes:{" "}
                  {state.connection.scopes ?? "not reported"}
                </p>
              </div>
            ) : null}

            {!state.encryptionConfigured ? (
              <p className="rounded-lg border border-warning-line bg-warning-soft px-3 py-2 text-[11px] leading-5 text-warning">
                Set <code>APP_ENCRYPTION_KEY</code> to store a token in the
                database. A server-side <code>GITHUB_TOKEN</code> still works.
              </p>
            ) : (
              <div className="space-y-2">
                <Field
                  label="Personal access token"
                  hint="Classic: repo. Fine-grained: Contents and Pull requests read/write, Metadata read. The token is encrypted and never shown again."
                >
                  <Input
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="github_pat_..."
                    autoComplete="off"
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    onClick={() => void save()}
                    disabled={busy || token.trim().length < 20}
                  >
                    {busy ? "Saving..." : "Save token"}
                  </Button>
                  {state.connection ? (
                    <Button
                      variant="danger"
                      onClick={() => void disconnect()}
                      disabled={busy}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            )}

            {state.envTokenConfigured ? (
              <p className="text-xs text-muted">
                A server-side <code>GITHUB_TOKEN</code> is also configured and
                is used when no stored connection exists.
              </p>
            ) : null}
            {notice ? (
              <p className="text-xs text-success">
                {notice}
              </p>
            ) : null}
            {error ? (
              <p className="text-xs text-danger">{error}</p>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}
