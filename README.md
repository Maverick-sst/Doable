# Doable

Doable is a **local-first AI software engineering workspace**. It takes an idea
through structured discovery, versioned requirements, architecture and planning
artifacts, specialist frontend/backend agents, real project files, inspection,
and ZIP export.

The browser app, Postgres metadata, Temporal worker, and generated workspaces
run on your machine. Only an explicitly selected remote inference provider sends
request content off the machine.

## What works today

- Local single-user mode (no Clerk required).
- Project creation with name, description, and domain.
- Discovery chat that produces a validated `DISCOVERY_REQUIREMENT` artifact.
- Explicit approval gate before a build.
- Temporal-orchestrated HCR graph:
  `ARCHITECT → RESEARCH → PRD_REVIEWER → PLANNER → FRONTEND_ENG + BACKEND_ENG`.
- Versioned artifacts, runtime events, node timeline, failure recovery, retry,
  and cancellation.
- Filesystem-canonical workspace under `DOABLE_HOME`, with a Postgres mirror.
- Disposable Kubernetes verification sandbox (install, build, tests, live
  preview, screenshot/console evidence) with a bounded one-pass repair and
  re-verification. Requires an enforcing NetworkPolicy CNI such as Calico.
- File tree, file viewer/editor, artifact inspector, ZIP export.
- Provider seam for Ollama/OpenAI-compatible local models and OpenRouter.
- Health/readiness endpoint at `/api/health`.

## Prerequisites

- **Bun** 1.1+ (the repo uses `bun.lock`).
- **Node** 20.9+ (Next.js 16 requires it).
- **Docker** only if you use the bundled local services. You can point
  `DATABASE_URL` at any Postgres 16+ database with the `vector` extension and
  run Temporal yourself.
- **Kubernetes with a NetworkPolicy-enforcing CNI** (optional; Calico is
  tested) plus `kubectl` and a built sandbox image for workspace verification.
- **Ollama** (optional but recommended for a fully local model).

## Quick start

```bash
cp .env.example .env

# 1. Local Postgres (pgvector) + Temporal. Binds to 127.0.0.1 only.
docker compose -f docker-compose.local.yml up -d
docker compose -f docker-compose.local.yml ps

# 2. Install and prepare the database
bun install
bunx prisma generate
bunx prisma migrate deploy

# 3. Pull a local model (recommended; ~2-4 GB depending on the model)
ollama pull llama3.2
ollama pull nomic-embed-text

# 4. Start the worker in one terminal
bun run temporal:worker

# 5. Start the app in another terminal
bun run dev
```

Open <http://127.0.0.1:3000>. The app binds to loopback by default.

### Using an existing Postgres

Set `DATABASE_URL` in `.env`, keep `DATABASE_DRIVER=pg`, and ensure the
`vector` extension is available. Run `bunx prisma migrate deploy`.

### Using a remote model provider

RunAnywhere (OpenAI-compatible chat + tools, no embeddings):

```env
MODEL_PROVIDER=runanywhere
RUNANYWHERE_API_KEY=...
MODEL=glm-5.3-flash
```

OpenRouter (chat + embeddings):

```env
MODEL_PROVIDER=openrouter
OPENROUTER_API_KEY=...
MODEL=<your selected open-weight model>
EMBEDDING_MODEL=<your selected embedding model>
```

Only the context needed for each model call is sent to the provider. Do not
claim local-only operation while remote inference is enabled. When the chosen
provider has no embedding endpoint, semantic file search is skipped and
recorded as an `embeddings.skipped` runtime event; builds still run.

### Sandbox verification

The workspace check runs in a disposable namespace and pod: install, build,
tests, a preview server, and a browser probe. Commands come only from
`package.json`; project scripts cannot be supplied by a model. The pod is
non-root, read-only at the root filesystem, has no service-account token, no
host mounts, and a default-deny egress policy that permits internet HTTP(S)
and cluster DNS while blocking private address ranges.

```bash
# Build the sandbox image and make it available to your cluster.
docker build -f docker/sandbox/Dockerfile -t doable-sandbox:latest .
minikube image load doable-sandbox:latest

# Or with a Docker-backed minikube:
eval "$(minikube docker-env)"
docker build -f docker/sandbox/Dockerfile -t doable-sandbox:latest .
```

Set `SANDBOX_IMAGE` if you use another tag. Screenshot evidence uses a host
Chrome/Chromium via `DOABLE_BROWSER_PATH`; without a browser the report records
that visual evidence was unavailable rather than claiming a screenshot.

Repair is bounded by `REPAIR_MAX_ATTEMPTS` (1-3, default 2): a failed
verification with application evidence is repaired once and re-verified. A
blocked sandbox is never repaired, and only a fresh PASSED report marks the
workspace verified.

## Scripts

| Command | Purpose |
|---|---|
| `bun run dev` | Next.js dev server on `127.0.0.1:3000` |
| `bun run build` | Production build |
| `bun run typecheck` | TypeScript check |
| `bun test` | Unit tests |
| `bun run lint` | ESLint |
| `bun run prisma:validate` | Validate the schema |
| `bun run prisma:generate` | Generate the Prisma client |
| `bun run prisma:migrate` | Create/apply a dev migration |
| `bun run temporal:worker` | Start the Temporal worker |
| `bun run temporal:up` / `down` | Local services |
| `bun run health` | CLI health check (when implemented) |

## Architecture

```text
Browser workspace (Next.js App Router)
  ├─ Control-plane API routes
  ├─ Discovery (synchronous, validated artifact)
  └─ Build start → single Temporal boundary
                         │
                    Temporal workflow
                         │
              ┌──────────┴──────────┐
              │  HCR node activities │
              └──────────┬──────────┘
                         │
            Postgres (state/artifacts/events)
                         │
            Workspace files (DOABLE_HOME)
```

**Seams**

- `src/auth` — local profile vs optional hosted identity.
- `src/providers` — model/embedding provider interface and adapters.
- `src/runtime/state` — one idempotent failure/success/cancel transition.
- `src/runtime/artifacts` — the only artifact write path; project-wide revisions.
- `src/runtime/files` — DB metadata + workspace bytes + embeddings.
- `src/runtime/workspace` — safe paths, atomic writes, manifest, ZIP export.
- `src/runtime/sandbox` — sandbox contract, command planning, Kubernetes adapter.
- `src/runtime/verification` — sandbox runner, evidence, verification start seam.
- `src/runtime/repair` — bounded evidence-driven repair pass.
- `src/temporal/runtime` — the only build-start/cancel/retry boundary.
- `src/hcr/context-engine` — retrieval and pure context assembly.

**Data locations**

- Postgres: projects, messages, workflows, executions, nodes, artifacts,
  runtime events, verification reports, and file metadata/content mirror.
- `DOABLE_HOME` (default `./.doable`): canonical generated files at
  `projects/<projectId>/`.
- `DOABLE_HOME/evidence/<projectId>/<reportId>/` — verification screenshots,
  served through an auth-scoped route and never stored as base64 in Postgres.
- Temporal: durable orchestration history.

## Repository layout

```text
app/               Next.js pages and thin API routes
components/        Product UI
src/auth/          Local/hosted authentication seam
src/cognition/     Agent registry, prompts, node executor, discovery
src/hcr/           Context engine and agent configuration
src/providers/     Model/embedding providers
src/runtime/       Artifacts, files, state, workspace, workflows
src/temporal/      Client, worker, activities, workflows, contracts
prisma/            Schema and migrations (tracked)
tests/             Unit tests
docs/              Architecture, ADRs, PRDs, research
```

## Verification status

The current checkout has been verified with:

- `bunx tsc --noEmit --incremental false`
- `bun test`
- `bun run lint`
- `bun run build`

A live Temporal + Postgres golden path is **not** claimed until it has been run
against the local services. See `docs/architecture/current-state.md`.

## Privacy and security

- Local mode has no hosted identity provider in the critical path.
- Services are intended to bind to loopback; do not expose the app publicly
  without adding authentication and origin protections.
- Generated files are validated for traversal and symlink escape.
- ZIP export excludes dependency caches, Git internals, and local env files.
- Prompts, model output, secrets, and file contents are not logged by default.
- Remote inference/MCP integrations are explicit choices.

## Documentation

- `AGENTS.md` — working rules for contributors and coding agents.
- `docs/architecture/current-state.md` — actual implementation state.
- `docs/adr/` — architecture decisions.
- `docs/prd/` — product requirements.
- `PHASE_4_PRD.md`, `PHASE_5.MD` — historical runtime PRDs.
- `d-2/hcr/` — Temporal migration archaeology and caveats.
- `d-3/agent_configuration/` — agent-config and context-engine boundaries.