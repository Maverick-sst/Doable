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
  cn,
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

const activeStatuses = [
  "DISCOVERY",
  "RUNNING",
  "IN_PROGRESS",
  "PENDING",
  "QUEUED",
  "PAUSED",
];

function relativeTime(value: string): string {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "Recently";
  const seconds = Math.round((then - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return "Just now";
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3.75 7.25A2.25 2.25 0 0 1 6 5h3.1c.5 0 .98.2 1.33.55l1.05 1.05c.35.35.83.55 1.33.55H18A2.25 2.25 0 0 1 20.25 9.4v7.35A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25z" />
    </svg>
  );
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4.5 7h15M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M7 7l.7 12.1A2 2 0 0 0 9.7 21h4.6a2 2 0 0 0 2-1.9L17 7" />
    </svg>
  );
}

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
      const data = (await response.json()) as {
        projects?: Project[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Could not load projects");
      setProjects(data.projects ?? []);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load projects",
      );
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
      const data = (await response.json()) as {
        projectId?: string;
        error?: string;
      };
      if (!response.ok || !data.projectId) {
        throw new Error(data.error ?? "Could not create project");
      }
      router.push(`/projects/${data.projectId}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create project",
      );
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

  const active = projects.filter((project) =>
    activeStatuses.includes(project.status),
  ).length;
  const complete = projects.filter(
    (project) => project.status === "COMPLETED",
  ).length;

  return (
    <AppShell>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">
            Overview
          </p>
          <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.035em] text-ink">
            Projects
          </h1>
          <p className="mt-1.5 max-w-xl text-[12.5px] leading-5 text-muted">
            Start with an idea. Approve the requirements, then let the build run
            on your machine.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-4 text-[11px] text-muted sm:flex">
            <span>
              <strong className="font-medium text-ink tabular-nums">
                {projects.length}
              </strong>{" "}
              total
            </span>
            <span className="h-3 w-px bg-line" />
            <span>
              <strong className="font-medium text-ink tabular-nums">
                {active}
              </strong>{" "}
              in flight
            </span>
            <span className="h-3 w-px bg-line" />
            <span>
              <strong className="font-medium text-ink tabular-nums">
                {complete}
              </strong>{" "}
              complete
            </span>
          </div>
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-5 rounded-lg border border-danger-line bg-danger-soft px-3.5 py-2.5 text-[12px] text-danger">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0">
          {loading ? (
            <Card>
              <CardBody>
                <Spinner label="Loading projects" />
              </CardBody>
            </Card>
          ) : projects.length === 0 ? (
            <EmptyState
              title="No projects yet"
              description="Describe a product on the right. Discovery keeps the scope honest before any code is written."
            />
          ) : (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
                  All projects
                </p>
                <span className="text-[10px] tabular-nums text-faint">
                  {projects.length}
                </span>
              </div>
              <div className="divide-y divide-line">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-hover"
                  >
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-rail text-faint">
                      <FolderIcon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/projects/${project.id}`}
                          className="truncate text-[13px] font-medium tracking-[-0.005em] text-ink hover:underline hover:underline-offset-2"
                        >
                          {project.name}
                        </Link>
                        <Badge tone={statusTone(project.status)}>
                          {project.status}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-1 max-w-xl text-[11.5px] leading-5 text-muted">
                        {project.description || "No description"}
                      </p>
                      <p className="mt-1 text-[10.5px] text-faint">
                        Updated {relativeTime(project.updatedAt)}
                      </p>
                      {project.failureReason ? (
                        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[10.5px] leading-4 text-danger">
                          <span className="size-1.5 shrink-0 rounded-full bg-danger" />
                          <span className="truncate">{project.failureReason}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
                      <button
                        type="button"
                        aria-label={`Delete ${project.name}`}
                        onClick={() => void removeProject(project)}
                        className="grid size-7 place-items-center rounded-md text-faint opacity-0 transition hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <TrashIcon className="size-3.5" />
                      </button>
                      <Link
                        href={`/projects/${project.id}`}
                        aria-label={`Open ${project.name}`}
                        className="grid size-7 place-items-center rounded-md text-faint transition hover:bg-active hover:text-ink"
                      >
                        <ArrowIcon className="size-3.5" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </section>

        <Card className="h-fit scroll-mt-8 lg:sticky lg:top-6" id="new-project">
          <CardHeader
            title="New project"
            description="Name it and choose a surface. Discovery begins in the workspace."
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
                  autoFocus={false}
                />
              </Field>
              <Field
                label="Short description"
                hint="Optional. Discovery will refine it into requirements."
              >
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  placeholder="A quiet task manager for small remote teams..."
                />
              </Field>
              <Field label="Surface">
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-rail p-1">
                  {[
                    {
                      value: "FULL_STACK_APPLICATION",
                      label: "Full-stack app",
                    },
                    { value: "LANDING_PAGE", label: "Landing page" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setDomain(option.value)}
                      aria-pressed={domain === option.value}
                      className={cn(
                        "h-7 rounded-md text-[11px] font-medium transition-colors",
                        domain === option.value
                          ? "bg-canvas text-ink shadow-sm"
                          : "text-muted hover:text-ink",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </Field>
              <Button
                type="submit"
                disabled={creating || !name.trim()}
                className="h-9 w-full"
              >
                {creating ? "Creating..." : "Create project"}
              </Button>
            </form>
            <p className="mt-3 border-t border-line pt-3 text-[10.5px] leading-4 text-faint">
              Nothing is built until you approve the requirements artifact.
            </p>
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
