# Doable

Doable is a **local-first AI software engineering workspace**. It takes an idea
through structured discovery, versioned requirements, architecture and planning
artifacts, specialist frontend/backend agents, real project files, verification,
inspection, GitHub push, and ZIP export.

The browser app, Postgres metadata, Temporal worker, and generated workspaces
run on your machine. Only an explicitly selected remote inference provider sends
request content off the machine.

```text
Describe → Discover → Approve → Build → Inspect → Verify → Keep
```

## Product flow

| Stage | What happens |
|---|---|
| **Describe** | Create a project with a name, description, and surface type. |
| **Discover** | A focused chat extracts goals, users, constraints, flows, data, and acceptance criteria. |
| **Approve** | Discovery writes a validated, versioned `DISCOVERY_REQUIREMENT` artifact. Nothing is built before approval. |
| **Build** | Temporal runs the HCR graph: architecture, research, PRD review, planning, frontend engineering, and backend engineering. |
| **Inspect** | Every artifact is versioned. Generated files are editable in the workspace and mirrored in Postgres. |
| **Verify** | An optional disposable Kubernetes sandbox runs install, build, tests, a live preview, and browser evidence. |
| **Keep** | Workspaces live under `DOABLE_HOME`; export a clean ZIP or explicitly push to GitHub. |

## Application surface

| Route | Purpose |
|---|---|
| `/` | Product landing page and entry into the workspace. |
| `/dashboard` | Project overview, recent projects, status counts, project creation, and deletion. |
| `/projects/[id]` | Project workspace with `Discovery`, `Build`, `Artifacts`, `Files`, and `GitHub` tabs. |
| `/settings` | Live service health, provider/routing state, local data paths, cache state, and GitHub configuration. |
| `/api/*` | Thin control-plane routes for projects, discovery, builds, files, artifacts, verification, export, and GitHub. |

The UI uses a shared `AppShell` with project navigation, a recent-project rail,
a compact top bar, and a light/dark token system defined in `app/globals.css`.
Local Inter and JetBrains Mono font files are bundled under `public/fonts/`.

## What works today

- Local single-user mode with no Clerk requirement.
- Project creation with name, description, and surface type.
- Discovery chat producing a validated requirements artifact.
- Explicit approval gate before build.
- Temporal-orchestrated HCR graph with durable retries and cancellation.
- Versioned artifacts, runtime events, node timeline, failure recovery, and
  resumable retry.
- Filesystem-canonical workspaces with a Postgres mirror.
- Artifact inspector, file tree, file viewer/editor, and ZIP export.
- Model routing across local and selected remote providers, with local-only
  fail-closed mode.
- Layered project memory, context compaction, and a scoped derived cache.
- Disposable Kubernetes verification with install/build/test/preview/browser
  evidence and a bounded one-pass repair.
- Optional GitHub repository context and explicit workspace pushes.
- Health/readiness endpoint at `/api/health`.

## Stack

| Layer | Technology |
|---|---|
| Web | Next.js 16 App Router, React 19, Tailwind CSS 4 |
| Runtime | Bun 1.3, Node 20.9+ |
| Data | Prisma 7, Postgres 16 with `pgvector` |
| Orchestration | Temporal TypeScript SDK |
| Auth | Local mode by default; optional hosted Clerk adapter |
| Models | Ollama, OpenAI-compatible RunAnywhere, OpenRouter |
| Sandbox | Kubernetes + Calico NetworkPolicy, optional |
| Tests | `bun test` |

## Prerequisites

- **Bun** 1.1+ (`bun.lock` is canonical).
- **Node** 20.9+.
- **Docker** for the bundled Postgres and Temporal services, unless you provide
  your own.
- **Postgres 16+ with the `vector` extension** if not using the compose file.
- **Ollama** for fully local inference, or credentials for a remote provider.
- **Kubernetes with an enforcing NetworkPolicy CNI** (Calico tested), `kubectl`,
  and a built sandbox image only if you want workspace verification.
- **Chrome/Chromium** on the host for screenshot evidence.

## Quick start

```bash
# 1. Configure local defaults.
cp .env.example .env

# 2. Install dependencies.
bun install

# 3. Start Postgres + Temporal. All ports bind to 127.0.0.1.
bun run temporal:up
docker compose -f docker-compose.local.yml ps

# 4. Generate the Prisma client and apply tracked migrations.
bunx prisma generate
bunx prisma migrate deploy

# 5. Pull a local model and embedding model.
ollama pull llama3.2
ollama pull nomic-embed-text

# 6. Start the Temporal worker in one terminal.
bun run temporal:worker

# 7. Start the app in another terminal.
bun run dev
```

Open <http://127.0.0.1:3000>.

Local services:

- App: <http://127.0.0.1:3000>
- Postgres: `127.0.0.1:5432`
- Temporal: `127.0.0.1:7233`
- Temporal UI: <http://127.0.0.1:8080>

The worker is required for builds and verification. The app and discovery chat
still start without it, but a build will report that no worker is available.

### Using an existing Postgres

Set `DATABASE_URL` in `.env`, keep `DATABASE_DRIVER=pg`, and ensure the `vector`
extension is available. Then run:

```bash
bunx prisma migrate deploy
```

Never run `prisma migrate dev` or reset a shared database without a backup.

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
MODEL=<selected open-weight model>
EMBEDDING_MODEL=<selected embedding model>
```

To guarantee that no remote model is ever selected:

```env
MODEL_LOCAL_ONLY=true
```

Only the context needed for each model call is sent to the provider. When the
selected provider has no embedding endpoint, semantic file search is skipped and
recorded as `embeddings.skipped`; builds still run.

### Sandbox verification

The workspace check runs in a disposable Kubernetes namespace and pod: install,
build, tests, preview server, and a browser probe. Commands come only from
`package.json` and lockfiles, never from model output.

```bash
docker build -f docker/sandbox/Dockerfile -t doable-sandbox:latest .
minikube image load doable-sandbox:latest
```

For a Docker-backed minikube:

```bash
eval "$(minikube docker-env)"
docker build -f docker/sandbox/Dockerfile -t doable-sandbox:latest .
```

Set `SANDBOX_IMAGE` for another tag. The cluster must enforce NetworkPolicy;
kindnet and other non-enforcing CNIs are not sufficient. If `kubectl`, the
cluster, or the image is unavailable, verification returns an honest `BLOCKED`
report instead of claiming success.

Repair is verify → repair → verify, bounded by `REPAIR_MAX_ATTEMPTS` (1–3,
default 2). Only a fresh `PASSED` report marks the workspace verified.

## Configuration

Start from `.env.example`. The most important groups are:

| Variable | Purpose |
|---|---|
| `AUTH_MODE` | `local` by default; `hosted` enables the optional Clerk adapter. |
| `DATABASE_DRIVER` | `pg` for local Postgres, `neon` for the optional hosted adapter. |
| `DATABASE_URL` | Postgres connection string. |
| `DOABLE_HOME` | Canonical project workspace root; default `./.doable`. |
| `TEMPORAL_HOST` / `TEMPORAL_TASK_QUEUE` | Temporal endpoint and worker queue. |
| `MODEL_PROVIDER` | `ollama`, `openrouter`, or `runanywhere`. |
| `MODEL_LOCAL_ONLY` | Fail closed instead of selecting any remote candidate. |
| `MODEL_FALLBACKS` | Ordered `provider:model` fallbacks. |
| `NODE_BUDGET_*` / `NODE_MAX_ITERATIONS` | Bounded agent execution. |
| `CONTEXT_TOKEN_BUDGET` | Assembled-context ceiling. |
| `CACHE_*` | Derived-cache size, TTL, and disable switch. |
| `SANDBOX_*` | Image, resource limits, timeouts, and output caps. |
| `REPAIR_MAX_ATTEMPTS` | Bounded repair attempts. |
| `DOABLE_BROWSER_PATH` | Host Chrome/Chromium used for visual evidence. |
| `APP_ENCRYPTION_KEY` | AES-256-GCM key for stored GitHub tokens. |
| `GITHUB_TOKEN` / `GITHUB_MCP_URL` | Server-side GitHub fallback and read-only MCP context. |

## Architecture

```text
┌──────────────────────────────── Browser ─────────────────────────────────┐
│ Next.js App Router                                                       │
│ / · /dashboard · /projects/[id] · /settings                              │
│ AppShell · workspace tabs · health, routing, cache, GitHub settings      │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ same-origin fetch
┌───────────────────────────────▼──────────────────────────────────────────┐
│ API routes                                                               │
│ Zod validation · local ownership scope · thin handlers                   │
│ projects · discovery/chat · build lifecycle · files/artifacts · health   │
└───────┬──────────────────────────┬──────────────────────────┬────────────┘
        │                          │                          │
┌───────▼────────┐       ┌─────────▼─────────┐      ┌─────────▼───────────┐
│ Postgres       │       │ src/providers     │      │ src/temporal/runtime│
│ Prisma 7       │       │ catalog + router  │      │ build/cancel/retry  │
│ metadata/state │       │ retries + breaker │      │ single boundary     │
└────────────────┘       └─────────┬─────────┘      └─────────┬───────────┘
                                   │                          │
                         Ollama / OpenRouter /          Temporal workflow
                         RunAnywhere                           │
                                                    ┌──────────▼──────────┐
                                                    │ HCR node activities │
                                                    └──────────┬──────────┘
                                                               │
                          artifacts · files · state · verification seams
                                                               │
                                            Postgres + DOABLE_HOME workspace
```

### Build graph

```text
ARCHITECT → RESEARCH → PRD_REVIEWER → PLANNER
                                      ├─ FRONTEND_ENG
                                      └─ BACKEND_ENG
```

- `hcrWorkflow` owns the durable build and fan-out/join.
- `verificationWorkflow` runs verification, optional bounded repair, and a fresh
  re-verification.
- `memoryCurationWorkflow` runs after discovery/build finalization and cannot
  fail the parent build.
- Repair is its own execution/node and may edit source only. Changed files come
  from a workspace snapshot diff, not model claims.

### Deep module seams

| Seam | Responsibility |
|---|---|
| `src/auth` | Local profile vs optional hosted identity. |
| `src/providers` | Model catalog, routing, local-only egress, retries, circuit breaker, usage. |
| `src/hcr/agent-config` | Versioned agent prompts, output contracts, and limits. |
| `src/hcr/agent-turn` | Shared model/tool loop with validation, allow-lists, and bounds. |
| `src/hcr/context-engine` | Retrieval plus pure deterministic context assembly. |
| `src/cognition/node-executor.ts` | Bounded node execution; no orchestration events. |
| `src/runtime/state` | One idempotent failure/success/cancel/retry transition. |
| `src/runtime/artifacts` | The only artifact write path; revisions per `(projectId, type)`. |
| `src/runtime/files` | DB metadata + workspace bytes + embeddings. |
| `src/runtime/workspace` | Path safety, atomic writes, manifest, ZIP export. |
| `src/runtime/cache` | Scoped derived-state cache; fail-open. |
| `src/runtime/memory` | Episodic, semantic, procedural, and preference memory plus curation. |
| `src/runtime/sandbox` | Sandbox contract, command planning, Kubernetes adapter. |
| `src/runtime/verification` | Runner, evidence, and the only manual verification start seam. |
| `src/runtime/repair` | Bounded evidence-driven source repair. |
| `src/runtime/github` | GitHub reads and atomic workspace pushes. |
| `src/temporal/runtime` | The only build-start/cancel/retry boundary. |

## Runtime invariants

1. **Temporal is the only orchestrator.** Inngest is not part of the runtime.
2. **Artifacts are created only through `createArtifact()`.** Revision scope is
   `(projectId, type)`.
3. **Project status is changed only through the state seam.** Routes do not
   write status directly.
4. **Trusted identity is injected server-side.** `projectId`, user ID, and
   workspace root are never accepted from model output.
5. **Filesystem access goes through the workspace/file seam.** Paths are
   relative, traversal-safe, and symlink-safe.
6. **A failed build, cancelled build, and successful build each have one
   idempotent transition.**
7. **Verification claims require a fresh `PASSED` report.** Missing browser or
   cluster evidence is reported as unavailable, never invented.

## Data and storage

- **Postgres**: projects, messages, workflows, executions, nodes, artifacts,
  runtime events, verification reports, memory, derived cache, and file
  metadata/content mirrors.
- **`DOABLE_HOME`** (default `./.doable`): canonical generated files at
  `projects/<projectId>/`.
- **`DOABLE_HOME/evidence/<projectId>/<runId>/`**: screenshots and verification
  evidence, served through an auth-scoped route. Image bytes are not stored in
  Postgres.
- **Temporal**: durable workflow histories and activity retry state.

`docker compose down` preserves named volumes. `down -v` deletes local database
metadata; generated workspaces under `DOABLE_HOME` are separate.

## API surface

| Group | Routes |
|---|---|
| Projects | `/api/projects`, `/api/projects/[id]` |
| Discovery | `/api/projects/[id]/discovery`, `/api/projects/[id]/chat` |
| Build lifecycle | `/api/projects/[id]/{status,hcr,cancel,retry}` |
| Artifacts and files | `/api/projects/[id]/{artifacts,files,files/[fileId]}` |
| Verification | `/api/projects/[id]/verifications`, `/evidence/[...path]` |
| Export | `/api/projects/[id]/export` |
| GitHub | `/api/projects/[id]/github`, `/github/push`, `/github/push/[pushId]` |
| Platform | `/api/health`, `/api/temporal/hcr`, `/api/temporal/pilot`, `/api/github/connection` |
| Hosted adapter | `/api/webhooks/clerk` |

Every data route validates input with Zod and scopes reads/writes to the
authenticated or local user.

## Repository layout

```text
app/                  Next.js routes, layout, global design tokens
components/           App shell, workspace, shared UI, GitHub panels, brand
lib/                  Prisma, auth-user, embeddings, tools, GitHub responses
src/auth/             Local/hosted authentication seam
src/providers/        Provider catalog, router, retries, health, adapters
src/hcr/              Agent config, shared agent turn, context engine
src/cognition/        Discovery, agent registry, prompts, node executor
src/runtime/
  artifacts/          Versioned artifact writes
  files/              Workspace files + DB mirror + embeddings
  workspace/          Path safety, atomic I/O, manifest, ZIP
  state/              Canonical project/workflow/execution/node transitions
  cache/              Hot + durable scoped derived cache
  memory/             Layered memory and deterministic curation
  sandbox/            Sandbox contract and Kubernetes adapter
  verification/       Runner, evidence, verification start
  repair/             Bounded evidence-driven repair
  github/             GitHub integration and pushes
  workflows/          Product workflow records
  temporal/           Worker, client, contracts, activities, workflows
prisma/               Schema and tracked migrations
docker/               Local services and sandbox image
scripts/              Health, Temporal, and acceptance drills
tests/                Unit tests for validators, state, paths, routing, HCR
docs/                 Architecture, ADRs, PRDs, plans, research
public/fonts/         Bundled Inter and JetBrains Mono
```

## Scripts

| Command | Purpose |
|---|---|
| `bun run dev` | Next.js dev server on `127.0.0.1:3000` |
| `bun run build` | Production build |
| `bun run typecheck` | TypeScript check |
| `bun test` | Unit tests |
| `bun run lint` | ESLint |
| `bun run prisma:validate` | Validate the Prisma schema |
| `bun run prisma:generate` | Generate the Prisma client |
| `bun run prisma:migrate` | Create/apply a local dev migration |
| `bun run temporal:worker` | Start the Temporal worker |
| `bun run temporal:up` / `temporal:down` | Start/stop local services |
| `bun run health` | CLI health check |

## Verification status

Static and build checks on this checkout (2026-10-27):

| Check | Result |
|---|---|
| `bun run typecheck` | Pass |
| `bun test` | 138 pass, 0 fail, 623 expectations |
| `bun run lint` | Pass |
| `bun run build` | Pass |

The following are intentionally **not claimed** until run on the target
environment:

- Full browser E2E golden path (`create → discovery → approve → build →
  inspect → export`).
- Live sandbox verification and repair against a real Calico cluster.
- Worker restart during an in-flight activity.
- Production desktop packaging.

See `docs/architecture/current-state.md` and
`docs/plans/NEXT_PHASE_PLAN.md` for implementation notes and remaining gates.

## Troubleshooting

| Symptom | Check |
|---|---|
| Prisma client missing | `bunx prisma generate` |
| `vector` extension error | Use `pgvector/pgvector:pg16` or install the extension. |
| Build never starts | Worker running? Temporal reachable? Check `/settings` and Temporal UI. |
| No eligible model | Check `MODEL_PROVIDER`, model IDs, `MODEL_LOCAL_ONLY`, and `/settings`. |
| Semantic search skipped | Provider has no embeddings endpoint; builds continue. |
| Verification `BLOCKED` | `kubectl`, cluster, NetworkPolicy CNI, or sandbox image unavailable. |
| No screenshot evidence | Set `DOABLE_BROWSER_PATH` to a host Chrome/Chromium binary. |
| GitHub push unavailable | Configure `APP_ENCRYPTION_KEY` and a token in Settings, or `GITHUB_TOKEN`. |

## Privacy and security

- Local mode has no hosted identity provider in the critical path.
- Services bind to loopback by default. Do not expose the app publicly without
  authentication and origin protections.
- Every query is scoped to the local or authenticated user.
- Generated paths are checked for traversal and symlink escape.
- ZIP export excludes dependency caches, Git internals, and local env files.
- Prompts, model output, file contents, secrets, tokens, and PII are not logged
  by default.
- Remote inference and GitHub MCP access are explicit opt-ins.
- The verification pod is non-root, read-only at the root filesystem, has no
  service-account token or host mounts, and runs under a default-deny
  NetworkPolicy with DNS and internet HTTP(S) egress.

## Documentation

- `AGENTS.md` — contributor and agent working rules.
- `docs/architecture/current-state.md` — implementation state and known limits.
- `docs/adr/` — architecture decisions.
- `docs/prd/` — product requirements.
- `docs/plans/NEXT_PHASE_PLAN.md` — delivery and verification plan.
- `PHASE_4_PRD.md`, `PHASE_5.MD` — historical runtime PRDs.
- `d-2/hcr/` — Temporal migration archaeology and caveats.
- `d-3/agent_configuration/` — agent-config and context-engine boundaries.
