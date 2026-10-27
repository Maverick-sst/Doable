import Link from "next/link";
import { BrandMark } from "@/components/brand";

const steps = [
  {
    number: "01",
    title: "Discover",
    body: "A focused conversation extracts constraints, flows, data, and acceptance criteria.",
  },
  {
    number: "02",
    title: "Build",
    body: "Specialist agents plan and implement on a durable Temporal graph.",
  },
  {
    number: "03",
    title: "Keep",
    body: "Inspect artifacts and files, verify the result, export the workspace.",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-rail text-ink">
      <div className="mx-auto flex min-h-screen w-full max-w-[1120px] flex-col px-5 sm:px-8">
        <header className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark />
            <span className="text-[13px] font-semibold tracking-[-0.01em]">
              Doable
            </span>
          </Link>
          <nav className="flex items-center gap-1.5">
            <Link
              href="/settings"
              className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-hover hover:text-ink"
            >
              Settings
            </Link>
            <Link
              href="/dashboard"
              className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground transition hover:brightness-110"
            >
              Open workspace
            </Link>
          </nav>
        </header>

        <section className="grid flex-1 items-center gap-12 py-14 lg:grid-cols-[1.02fr_0.98fr] lg:py-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-canvas/70 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
              <span className="size-1.5 rounded-full bg-success" />
              Local-first engineering
            </p>
            <h1 className="mt-5 max-w-[560px] text-[42px] font-semibold leading-[1.03] tracking-[-0.045em] sm:text-[54px]">
              Software you can{" "}
              <span className="text-brand">inspect, edit, and keep.</span>
            </h1>
            <p className="mt-5 max-w-[490px] text-[13.5px] leading-6 text-muted">
              Doable turns an idea into a real project. Requirements first, a
              durable build second, and a workspace on your machine at the end.
              Nothing is hidden behind a black box.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <Link
                href="/dashboard"
                className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-[12.5px] font-medium text-accent-foreground shadow-sm transition hover:brightness-110"
              >
                Start a project
              </Link>
              <Link
                href="/settings"
                className="inline-flex h-9 items-center rounded-lg border border-line bg-canvas px-4 text-[12.5px] font-medium text-ink transition hover:bg-hover"
              >
                Configure models
              </Link>
            </div>
            <p className="mt-5 text-[10.5px] leading-4 text-faint">
              Postgres metadata · Temporal orchestration · files under{" "}
              <code className="rounded bg-hover px-1 py-0.5 text-[10px] text-muted">
                DOABLE_HOME
              </code>
            </p>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 -z-10 rounded-[32px] bg-[radial-gradient(circle_at_50%_30%,var(--accent-soft),transparent_68%)] opacity-80" />
            <div className="rounded-[20px] border border-line bg-canvas p-1.5 shadow-[var(--shadow-popover)]">
              <div className="overflow-hidden rounded-[14px] border border-line bg-rail">
                <div className="flex h-8 items-center gap-1.5 border-b border-line px-3">
                  <span className="size-2 rounded-full bg-line-strong" />
                  <span className="size-2 rounded-full bg-line-strong" />
                  <span className="size-2 rounded-full bg-line-strong" />
                  <span className="ml-2 text-[9px] font-medium text-faint">
                    Doable
                  </span>
                </div>
                <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-1.5 p-1.5">
                  <div className="space-y-3 rounded-[10px] px-1.5 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="size-4 rounded-[5px] bg-accent" />
                      <span className="h-1.5 w-8 rounded-full bg-line-strong" />
                    </div>
                    <div className="space-y-1.5">
                      <span className="block h-1.5 w-12 rounded-full bg-line-strong" />
                      <span className="block h-1.5 w-10 rounded-full bg-line" />
                      <span className="block h-1.5 w-11 rounded-full bg-line" />
                    </div>
                    <div className="space-y-1.5 pt-2">
                      <span className="block h-1 w-7 rounded-full bg-line" />
                      <span className="block h-1.5 w-12 rounded-full bg-line" />
                      <span className="block h-1.5 w-9 rounded-full bg-line" />
                    </div>
                  </div>
                  <div className="min-h-[280px] rounded-[10px] border border-line bg-canvas p-4">
                    <div className="flex items-center justify-between">
                      <span className="rounded bg-warning-soft px-1.5 py-0.5 text-[8px] font-medium text-warning">
                        DISCOVERY
                      </span>
                      <span className="text-[8px] text-faint">Local</span>
                    </div>
                    <p className="mt-5 text-[13px] font-semibold tracking-[-0.02em]">
                      A quiet task manager
                    </p>
                    <p className="mt-1 text-[9px] leading-4 text-muted">
                      Before I plan the build, who is this for?
                    </p>
                    <div className="mt-4 space-y-2">
                      <div className="ml-auto w-[78%] rounded-lg rounded-br-sm bg-accent px-2.5 py-2 text-[8.5px] leading-3.5 text-accent-foreground">
                        Small remote teams. Fewer notifications, clearer
                        ownership.
                      </div>
                      <div className="w-[84%] rounded-lg rounded-bl-sm bg-rail px-2.5 py-2 text-[8.5px] leading-3.5 text-muted">
                        Then the core loop is capture, assign, and a daily
                        review. Should completed work disappear immediately?
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between rounded-lg border border-line px-2.5 py-2">
                      <span className="text-[8px] text-faint">
                        Answer or add a constraint...
                      </span>
                      <span className="grid size-4 place-items-center rounded bg-accent text-[9px] text-accent-foreground">
                        ↑
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-3 -left-3 hidden items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[9px] font-medium text-muted shadow-[var(--shadow-card)] sm:flex">
              <span className="size-1.5 rounded-full bg-success" />
              Requirements drafted
            </div>
          </div>
        </section>

        <section className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
          {steps.map((step) => (
            <div key={step.number} className="bg-canvas p-5">
              <span className="font-mono text-[9px] text-faint">
                {step.number}
              </span>
              <h2 className="mt-3 text-[12px] font-semibold tracking-[-0.01em]">
                {step.title}
              </h2>
              <p className="mt-1.5 text-[11px] leading-5 text-muted">
                {step.body}
              </p>
            </div>
          ))}
        </section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-line py-5 text-[10px] text-faint">
          <span>Built for work that stays yours.</span>
          <span>Local mode · single user · private by default</span>
        </footer>
      </div>
    </main>
  );
}
