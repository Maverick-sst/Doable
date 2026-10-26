"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Spinner,
  Textarea,
  statusTone,
} from "@/components/ui";

type Project = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [domain, setDomain] = useState("FULL_STACK_APPLICATION");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      const data = (await response.json()) as { projects?: Project[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not load projects");
      setProjects(data.projects ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, domain }),
      });
      const data = (await response.json()) as { projectId?: string; error?: string };
      if (!response.ok || !data.projectId) {
        throw new Error(data.error ?? "Could not create project");
      }
      router.push(`/projects/${data.projectId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create project");
    } finally {
      setCreating(false);
    }
  }

  async function removeProject(project: Project) {
    if (!window.confirm(`Delete “${project.name}”? This removes its history.`)) {
      return;
    }
    const response = await fetch(`/api/projects/${project.id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setProjects((current) => current.filter((item) => item.id !== project.id));
    }
  }

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Start with an idea. Approve the requirements before a build begins.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="space-y-4">
          {loading ? (
            <Card>
              <CardBody>
                <Spinner label="Loading projects" />
              </CardBody>
            </Card>
          ) : projects.length === 0 ? (
            <EmptyState
              title="No projects yet"
              description="Create your first project on the right. Discovery will ask a few focused questions before anything is built."
            />
          ) : (
            projects.map((project) => (
              <Card key={project.id}>
                <CardBody className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/projects/${project.id}`}
                        className="truncate text-sm font-semibold text-zinc-950 hover:text-indigo-600 dark:text-zinc-50 dark:hover:text-indigo-400"
                      >
                        {project.name}
                      </Link>
                      <Badge tone={statusTone(project.status)}>
                        {project.status}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 max-w-xl text-xs text-zinc-500 dark:text-zinc-400">
                      {project.description || "No description"}
                    </p>
                    <p className="mt-2 text-[11px] text-zinc-400">
                      Updated {new Date(project.updatedAt).toLocaleString()}
                    </p>
                    {project.failureReason ? (
                      <p className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                        {project.failureReason}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Link href={`/projects/${project.id}`}>
                      <Button>Open</Button>
                    </Link>
                    <Button variant="danger" onClick={() => void removeProject(project)}>
                      Delete
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ))
          )}
        </section>

        <Card className="h-fit">
          <CardHeader
            title="New project"
            description="Name it, choose a domain, then start discovery."
          />
          <CardBody>
            <form className="space-y-4" onSubmit={createProject}>
              <Field label="Project name">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Team task manager"
                  maxLength={120}
                  required
                />
              </Field>
              <Field label="Short description" hint="Optional; discovery will refine it.">
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  placeholder="A task manager for small remote teams..."
                />
              </Field>
              <Field label="Domain">
                <select
                  className="h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                >
                  <option value="FULL_STACK_APPLICATION">
                    Full-stack application
                  </option>
                  <option value="LANDING_PAGE">Landing page</option>
                </select>
              </Field>
              <Button type="submit" disabled={creating || !name.trim()} className="w-full">
                {creating ? "Creating..." : "Create project"}
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}