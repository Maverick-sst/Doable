# AGENTS.md — Doable

Doable is a local-first AI software engineering workspace. Read this file and
`README.md` before changing code. The checked-in code is the source of truth;
historical PRDs describe intent, not necessarily the current implementation.

## Current stack

- Next.js **16** App Router, React 19, Tailwind CSS 4.
- Bun for scripts and tests; `bun.lock` is canonical.
- Prisma 7 + Postgres (local `pg` adapter by default; optional Neon adapter).
- Temporal TypeScript SDK for durable HCR orchestration.
- Local single-user auth by default (`AUTH_MODE=local`); optional hosted Clerk
  adapter is not in the critical path.
- Ollama/OpenAI-compatible local models or explicitly selected OpenRouter
  models.

## Architecture vocabulary

Use the `codebase-design` skill vocabulary when discussing structure:

- **Module**: anything with an interface and an implementation.
- **Interface**: everything a caller must know, including invariants and error
  modes.
- **Seam**: where a module's interface lives.
- **Adapter**: a concrete implementation at a seam.
- **Depth**: leverage at the interface.
- **Locality**: change and verification concentrated in one place.

Prefer deep modules with small interfaces. Do not add a seam unless something
actually varies across it. Apply the deletion test before extracting a module.

## Runtime seams that must stay coherent

- `src/auth` — local vs optional hosted identity.
- `src/providers` — chat/embedding provider interface and adapters.
- `src/runtime/state/transitions.ts` — the only failure/success/cancel/retry
  state transition for project, workflow, execution, and node.
- `src/runtime/artifacts` — the only artifact write path.
- `src/runtime/files` — DB metadata + workspace bytes + embeddings.
- `src/runtime/workspace` — path safety, atomic writes, manifest, ZIP export.
- `src/temporal/runtime.ts` — the only build-start/cancel/retry boundary.
- `src/hcr/context-engine` — retrieval plus pure assembly. No Inngest.
- `src/cognition/node-executor.ts` — bounded node execution; no orchestration
  events.

## Non-negotiable rules

1. **Do not reintroduce Inngest.** Temporal is the only orchestrator.
2. **Do not create artifacts outside `createArtifact()`.** Revision scope is
   per `(projectId, type)`.
3. **Do not write project status directly in routes.** Use the state seam.
4. **Do not pass trusted identity (`projectId`, user id, workspace root) to the
   model.** Inject it server-side.
5. **Do not log prompts, model output, file contents, secrets, tokens, or PII.**
   Log IDs, event types, durations, and safe error codes.
6. **Do not read/write the workspace without the workspace/file seam.** Paths
   must be relative, traversal-safe, and symlink-safe.
7. **Do not claim verification** unless the command actually ran against the
   stated revision.
8. **Do not run destructive database operations** (reset, truncate, drop,
   force-pushing migrations) without explicit approval and a backup plan.
9. **Do not silently promote a feature branch to `main`.** Fetch first; local
   `origin/main` can be stale.
10. **Keep generated/local data out of Git.** `.env*`, `.doable/`, raw evidence
    dumps, PDFs, and binaries stay untracked.

## Commands

```bash
bun install
bunx prisma validate
bunx prisma generate
bun run typecheck
bun test
bun run lint
bun run build
bun run temporal:worker
bun run temporal:up
bun run temporal:down
```

Use `bun run prisma:migrate` only with a local/dev database and after reviewing
the migration SQL. Never run migrations against a shared database without
approval.

## Security

- Local services bind to `127.0.0.1` by default.
- Every query is scoped to the authenticated/local user.
- File deletion and reads must be scoped by both project and file.
- Validate all user input with Zod.
- Validate tool arguments with Zod; path and size limits are mandatory.
- Do not expose debug routes in production; the Temporal pilot route is gated.
- Use `AUTH_MODE=hosted` only as an explicit adapter; local mode must not
  require Clerk or a hosted database.

## Code quality

- Strict TypeScript; no `any` without a justified comment.
- Small functions, explicit return types, named constants.
- Follow existing patterns and folder conventions.
- No giant utility files; prefer a deep module at a real seam.
- Comments explain *why*, not *what*.
- Keep lines under 100 characters where practical.
- If a change touches a module interface, update its tests and docs.

## Testing expectations

- Pure unit tests for validators, context assembly, provider normalization,
  state transitions, and path safety.
- Integration tests against a disposable Postgres for discovery, artifact
  revisions, failure recovery, and idempotency.
- Temporal tests for fan-out/join, duplicate start, retry exhaustion,
  cancellation, and worker restart.
- E2E golden path: create → discovery → approve → build → inspect → export.

## Before finishing a task

- Run typecheck, tests, lint, and build.
- Report exact commands and results.
- Report unverified areas honestly.
- Record changed files, schema migrations, and remaining risks in the handoff.
- Do not commit secrets or generated workspaces.

## Further reading

- `README.md`
- `docs/architecture/current-state.md`
- `docs/adr/`
- `docs/prd/`
- `PHASE_4_PRD.md`, `PHASE_5.MD` (historical)
- `d-2/hcr/HCR_KNOWN_CAVEATS.md`
- `d-3/agent_configuration/`