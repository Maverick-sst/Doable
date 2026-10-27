"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { BrandMark } from "./brand";
import { cn } from "./ui";

type ProjectSummary = {
  id: string;
  name: string;
  status: string;
};

function FolderIcon({ className }: { className?: string }) {
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
      <path d="M3.75 7.25A2.25 2.25 0 0 1 6 5h3.1c.5 0 .98.2 1.33.55l1.05 1.05c.35.35.83.55 1.33.55H18A2.25 2.25 0 0 1 20.25 9.4v7.35A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25z" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
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
      <path d="M12 15.25A3.25 3.25 0 1 0 12 8.75a3.25 3.25 0 0 0 0 6.5Z" />
      <path d="M19.4 13.2a7.8 7.8 0 0 0 0-2.4l1.4-1.1-1.9-3.3-1.7.7a7.9 7.9 0 0 0-2.1-1.2L14.8 4h-3.9l-.3 1.9a7.9 7.9 0 0 0-2.1 1.2L6.8 6.4 4.9 9.7l1.4 1.1a7.8 7.8 0 0 0 0 2.4l-1.4 1.1 1.9 3.3 1.7-.7a7.9 7.9 0 0 0 2.1 1.2l.3 1.9h3.9l.3-1.9a7.9 7.9 0 0 0 2.1-1.2l1.7.7 1.9-3.3z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function statusDot(status: string): string {
  if (["COMPLETED", "PASSED", "IDLE"].includes(status)) return "bg-success";
  if (["FAILED", "CANCELLED", "TIMED_OUT", "BLOCKED"].includes(status))
    return "bg-danger";
  if (["RUNNING", "IN_PROGRESS", "BUILDING"].includes(status)) return "bg-brand";
  if (["PENDING", "DISCOVERY", "QUEUED", "PAUSED"].includes(status))
    return "bg-warning";
  return "bg-faint";
}

function NavLink({
  href,
  label,
  active,
  icon,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] transition-colors",
        active
          ? "bg-active font-medium text-ink"
          : "text-muted hover:bg-hover hover:text-ink",
      )}
    >
      <span className={cn("shrink-0", active ? "text-ink" : "text-faint")}>
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return { projects: [] as ProjectSummary[] };
        return (await response.json()) as { projects?: ProjectSummary[] };
      })
      .then((data) => {
        if (!cancelled) setProjects((data.projects ?? []).slice(0, 6));
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const projectsActive =
    pathname === "/dashboard" || pathname.startsWith("/projects");
  const settingsActive = pathname === "/settings";
  const crumb = settingsActive
    ? "Settings"
    : projectsActive
      ? pathname.startsWith("/projects")
        ? "Project"
        : "Projects"
      : "Workspace";

  return (
    <div className="min-h-screen bg-rail text-ink lg:flex">
      <aside className="hidden w-[258px] shrink-0 flex-col px-3 py-4 lg:sticky lg:top-0 lg:flex lg:h-screen">
        <div className="flex items-center justify-between px-1.5 pb-4">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5">
            <BrandMark />
            <span className="text-[13px] font-semibold tracking-[-0.01em]">
              Doable
            </span>
            <span className="rounded-full border border-line bg-canvas/70 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-faint">
              local
            </span>
          </Link>
        </div>

        <Link
          href="/dashboard#new-project"
          className="mb-4 flex h-9 items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 text-[13px] font-medium text-ink shadow-sm transition-colors hover:bg-hover"
        >
          <PlusIcon className="size-3.5 text-muted" />
          New project
        </Link>

        <nav className="space-y-0.5">
          <p className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
            Workspace
          </p>
          <NavLink
            href="/dashboard"
            label="Projects"
            active={projectsActive}
            icon={<FolderIcon className="size-4" />}
          />
          <NavLink
            href="/settings"
            label="Settings"
            active={settingsActive}
            icon={<SettingsIcon className="size-4" />}
          />
        </nav>

        <div className="mt-5 min-h-0">
          <div className="flex items-center justify-between px-2 pb-1.5">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
              Recent
            </p>
            <span className="text-[10px] tabular-nums text-faint">
              {projects.length}
            </span>
          </div>
          <div className="space-y-0.5">
            {loading ? (
              [0, 1, 2].map((item) => (
                <div key={item} className="flex h-8 items-center gap-2 px-2">
                  <span className="size-1.5 rounded-full bg-line-strong" />
                  <span className="h-2.5 w-2/3 animate-pulse rounded bg-line" />
                </div>
              ))
            ) : projects.length === 0 ? (
              <p className="px-2 py-2 text-[11px] leading-4 text-faint">
                Projects you create will appear here.
              </p>
            ) : (
              projects.map((project) => {
                const active = pathname === `/projects/${project.id}`;
                return (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-8 items-center gap-2 rounded-lg px-2 text-[12.5px] transition-colors",
                      active
                        ? "bg-active text-ink"
                        : "text-muted hover:bg-hover hover:text-ink",
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        statusDot(project.status),
                      )}
                    />
                    <span className="truncate">{project.name}</span>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        <div className="mt-auto space-y-3 pt-5">
          <div className="rounded-xl border border-line bg-canvas/60 p-3">
            <div className="flex items-center gap-2 text-[11px] font-medium text-ink">
              <span className="size-1.5 rounded-full bg-success shadow-[0_0_0_3px_var(--success-soft)]" />
              Local runtime
            </div>
            <p className="mt-1.5 text-[10.5px] leading-4 text-faint">
              Private by default. Remote models only when you choose them.
            </p>
          </div>
          <div className="flex items-center gap-2.5 px-1">
            <span className="grid size-7 place-items-center rounded-full border border-line bg-canvas text-[10px] font-semibold text-muted">
              DM
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11.5px] font-medium text-ink">
                Local workspace
              </p>
              <p className="truncate text-[10px] text-faint">Owner</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1 lg:p-2 lg:pl-0">
        <div className="flex min-h-screen flex-col border-line bg-canvas lg:h-[calc(100vh-1rem)] lg:min-h-0 lg:rounded-2xl lg:border lg:shadow-[var(--shadow-card)]">
          <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-canvas/90 px-3 backdrop-blur lg:static lg:px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Link
                href="/dashboard"
                className="flex items-center gap-2 lg:hidden"
              >
                <BrandMark className="size-6 rounded-lg" />
                <span className="text-[13px] font-semibold">Doable</span>
              </Link>
              <div className="hidden min-w-0 items-center gap-1.5 text-[11.5px] lg:flex">
                <span className="text-faint">Workspace</span>
                <span className="text-line-strong">/</span>
                <span className="truncate font-medium text-muted">{crumb}</span>
              </div>
              <nav className="flex items-center gap-1 lg:hidden">
                <Link
                  href="/dashboard"
                  className={cn(
                    "rounded-lg px-2 py-1 text-[11px] font-medium",
                    projectsActive ? "bg-active text-ink" : "text-muted",
                  )}
                >
                  Projects
                </Link>
                <Link
                  href="/settings"
                  className={cn(
                    "rounded-lg px-2 py-1 text-[11px] font-medium",
                    settingsActive ? "bg-active text-ink" : "text-muted",
                  )}
                >
                  Settings
                </Link>
              </nav>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-full border border-line px-2 py-1 text-[10px] font-medium text-muted sm:inline-flex">
                <span className="size-1.5 rounded-full bg-success" />
                Local
              </span>
              <Link
                href="/settings"
                aria-label="Open settings"
                className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-ink"
              >
                <SettingsIcon className="size-4" />
              </Link>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
