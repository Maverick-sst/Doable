import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6">
        <header className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-500 text-xs font-bold">
              D
            </span>
            <span className="text-sm font-semibold tracking-tight">Doable</span>
          </div>
          <Link
            href="/dashboard"
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-zinc-500"
          >
            Open workspace
          </Link>
        </header>

        <section className="flex flex-1 flex-col justify-center py-20">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-indigo-400">
            Local-first AI software engineering
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            From an idea to a project you can inspect, edit, and keep.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400">
            Doable asks the right questions, turns them into versioned
            requirements, plans the build, and runs specialist agents through a
            durable Temporal workflow. Your code lives on your machine, in a
            real workspace you can export.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
            >
              Start a project
            </Link>
            <Link
              href="/settings"
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500"
            >
              Configure models
            </Link>
          </div>

          <div className="mt-16 grid gap-4 sm:grid-cols-3">
            {[
              {
                title: "Discover",
                body: "A conversation that extracts constraints, flows, data, and acceptance criteria.",
              },
              {
                title: "Build",
                body: "Architect, research, PRD, plan, then frontend and backend agents on a durable graph.",
              },
              {
                title: "Keep",
                body: "Inspect every artifact and file, export the workspace, and retry without losing history.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5"
              >
                <h2 className="text-sm font-semibold">{item.title}</h2>
                <p className="mt-2 text-xs leading-5 text-zinc-400">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <footer className="border-t border-zinc-900 py-5 text-[11px] text-zinc-600">
          Local mode stores project metadata in Postgres and generated files
          under <code className="text-zinc-400">DOABLE_HOME</code>. Remote
          inference only happens when you select a remote provider.
        </footer>
      </div>
    </main>
  );
}