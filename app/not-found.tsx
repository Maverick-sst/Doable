import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-zinc-50 px-6 dark:bg-zinc-950">
      <div className="text-center">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400">
          404
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          That page does not exist
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Head back to the workspace and pick a project.
        </p>
        <Link
          href="/dashboard"
          className="mt-5 inline-flex rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Open workspace
        </Link>
      </div>
    </main>
  );
}