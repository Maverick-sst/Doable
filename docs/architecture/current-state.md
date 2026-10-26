# Current State — Doable V1.1 Foundation

Last updated: 2026-10-26

This document describes the checked-in implementation, not the historical
aspiration in `PHASE_4_PRD.md` / `PHASE_5.MD`.

## Runtime

```text
Browser workspace
  ├─ /dashboard, /projects/[id], /settings
  ├─ Thin API routes (Zod + local ownership checks)
  └─ Build start
        ↓
  src/temporal/runtime.ts (single boundary)
        ↓
  Temporal workflow: hcrWorkflow
        ↓
  HCR node activities
    ARCHITECT → RESEARCH → PRD_REVIEWER → PLANNER
                                      → FRONTEND_ENG + BACKEND_ENG
        ↓
  Postgres state/artifacts/events + filesystem workspace
```

Temporal is the only orchestrator. Inngest code, registration, package, and
embedding job have been removed. File embeddings now run through
`src/runtime/embeddings` and degrade gracefully.

## Deep module seams

| Seam | Interface | Responsibility |
|---|---|---|
| `src/auth` | `getCurrentUser`, `requireDbUser` | Local single-user profile; optional hosted adapter |
| `src/providers` | `ModelProvider.chat/embed` + `capabilities` | Ollama, OpenRouter, RunAnywhere adapters |
| `src/runtime/state` | `failExecution`, `completeExecution`, `cancelExecution` | One idempotent state transition |
| `src/runtime/artifacts` | `createArtifact`, `getLatestArtifact` | Project-wide artifact revisions, hashes, events |
| `src/runtime/files` | `create/read/update/delete/listProjectFile` | DB metadata + workspace bytes + embeddings |
| `src/runtime/workspace` | `write/read/delete/list/export` | Safe paths, atomic writes, manifest, ZIP |
| `src/temporal/runtime` | `startBuild`, `cancelBuild`, `retryBuild` | Product-state creation + Temporal start |
| `src/hcr/context-engine` | `buildContext` | Retrieval + pure assembly |

## Provider capabilities

Each adapter declares `capabilities: { chat, tools, embeddings }`.

| Provider | Chat | Tools | Embeddings |
|---|---|---|---|
| `ollama` | yes | yes | yes |
| `openrouter` | yes | yes | yes |
| `runanywhere` | yes | yes | **no** |

When `embeddings` is false, the node executor records an
`embeddings.skipped` runtime event and runs without vector context. File
embeddings return `skipped` instead of making a failing network call. Semantic
search is optional by design.

## Data model changes

Migration `20261026110000_v11_foundation` adds:

- `Artifact`: `schemaVersion`, `validationStatus`, `contentHash`, unique
  `(projectId, type, version)`, unique `nodeId`.
- `Node`: `attempt`, `startedAt`, `finishedAt`, `failureReason`, unique
  `(executionId, order, type)`.
- `Execution`: Temporal workflow/run IDs, start/finish, failure reason.
- `Project`: `failureReason`, `archivedAt`, `workspacePath`, default
  `DISCOVERY`.
- `File`: `checksum`, `revision`, `size`, `mimeType`.
- `Message`: optional workflow/execution IDs.
- `VerificationReport` and `VerificationStatus`.
- `ArtifactType.VERIFICATION_REPORT`; `WorkflowType.VERIFICATION/REPAIR`.

### Migration preflight

The migration refuses to add uniqueness when existing duplicate
`Artifact.nodeId`, `(projectId, type, version)`, or
`(executionId, order, type)` rows exist. Reconcile those rows first; the
migration does not delete data.

## Security posture

- Local auth; no Clerk requirement in local mode.
- File DELETE is scoped by both project and file.
- `/test` unscoped database dump removed.
- Tool schemas no longer accept `projectId`; server injects it.
- Prompt/model output logging removed.
- `/api/temporal/pilot` is dev-gated.
- Workspace paths reject traversal and symlink escape.
- Local services bind to `127.0.0.1` in `docker-compose.local.yml`.

## Verified

Run on the current worktree:

| Command / drill | Result |
|---|---|
| `bunx tsc --noEmit --incremental false` | Pass |
| `bun test` | 47 pass, 0 fail (pure suites) |
| `bun run lint` (scoped TS/TSX) | Pass |
| `bun run build` | Pass |
| `bunx prisma validate` | Pass |
| `prisma migrate deploy` on disposable local Postgres | 14 migrations applied |
| `scripts/verify-local.ts` | Pass: artifact revisions, one-active-build lock, failure, cancel, late-completion guard, workspace, ZIP |
| `bun run temporal:hello` | Pass: `Hello, World from Temporal!` |
| `scripts/verify-temporal.ts` with mock provider | Pass: 6 nodes, 4 build artifacts, 2 files, 40 events, project IDLE |
| `scripts/verify-failure.ts` with `MOCK_FAIL_NODE=PLANNER` | Pass: PLANNER FAILED, ARCHITECT COMPLETED, exactly one `node.failed` |
| API golden path (Next dev + worker + mock provider) | Pass: create → discovery → approve → Temporal build → artifacts/files → ZIP → delete |

The local containers were stopped after verification; volumes were preserved.

## Not yet verified

- Real Ollama/OpenRouter model quality and latency.
- Browser-level E2E (the API golden path is verified; the UI is built but not
  driven by Playwright yet).
- Worker-restart-during-activity drill.
- Verification sandbox (build/test execution). Structural checks only today.
- Desktop packaging and REA/Alan feature-gap evidence.

These are the next verification gates; do not claim them until they run.

## Known remaining work

- Integration and Temporal test suites.
- Verification workflow/sandbox (the `VerificationReport` model exists; the
  runner does not).
- Bounded repair workflow.
- Agent-config/context-engine V2 integration (boundaries exist; node executor
  still consumes the registry directly).
- Model routing by role and cost accounting.
- Desktop shell packaging.
- REA/Alan feature-gap matrix (evidence not collected yet).