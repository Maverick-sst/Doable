import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-rail px-6">
      <div className="text-center">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand">
          404
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          That page does not exist
        </h1>
        <p className="mt-2 text-sm text-muted">
          Head back to the workspace and pick a project.
        </p>
        <Link
          href="/dashboard"
          className="mt-5 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:brightness-110"
        >
          Open workspace
        </Link>
      </div>
    </main>
  );
}