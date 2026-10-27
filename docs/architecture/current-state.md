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
| `src/providers` | `callChat`/`callEmbeddings`, `routeModel`, `routingSnapshot` | Adapters + D5 routing, local-only egress, retries, circuit breaker, usage/cost |
| `src/runtime/state` | `failExecution`, `completeExecution`, `cancelExecution` | One idempotent state transition |
| `src/runtime/artifacts` | `createArtifact`, `getLatestArtifact` | Project-wide artifact revisions, hashes, events |
| `src/runtime/files` | `create/read/update/delete/listProjectFile` | DB metadata + workspace bytes + embeddings |
| `src/runtime/workspace` | `write/read/delete/list/export` | Safe paths, atomic writes, manifest, ZIP |
| `src/runtime/cache` | `getOrLoad`, `invalidateProjectCache`, `cacheSnapshot` | Scoped derived-state cache; hot + durable, fail-open |
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
| `bun test` | 97 pass, 0 fail |
| `bun run lint` (scoped TS/TSX) | Pass |
| `bun run build` | Pass |
| `bunx prisma validate` | Pass |
| `prisma migrate status` on local Postgres | 15 migrations, schema up to date |
| `scripts/verify-local.ts` | Pass: artifact revisions, one-active-build lock, failure, cancel, late-completion guard, workspace, ZIP |
| `bun run temporal:hello` | Pass: `Hello, World from Temporal!` |
| `scripts/verify-temporal.ts` with mock provider | Pass: 6 nodes, 4 build artifacts, 2 files, 51 events, project IDLE; every node records `agentConfigVersion` + `agentConfigHash` and a `context.assembled` fingerprint; post-finalize curation created 3 memory entries |
| `scripts/verify-context.ts` (local Postgres) | Pass: 67 messages compacted into 1,000 tokens, facts preserved, stale verification visible, fingerprint stable |
| `scripts/verify-memory.ts` (local Postgres + mock embeddings) | Pass: 9 entries across semantic/procedural/episodic/preference, 9 embedded, replay inserted 0, user correction superseded curated value, deletion removed 2 versions, retrieval excluded deleted memory |
| `scripts/verify-budget.ts` with `NODE_MAX_ITERATIONS=3` | Pass: project INCOMPLETE, execution PARTIAL, 2 budget events, 6 files preserved |
| `scripts/verify-resume.ts` with `MOCK_FAIL_NODE=PLANNER` | Pass: attempt 1 FAILED, attempt 2 resumed at PLANNER, upstream artifacts stayed v1 |
| `scripts/verify-failure.ts` with `MOCK_FAIL_NODE=PLANNER` | Pass: PLANNER FAILED, ARCHITECT COMPLETED, exactly one `node.failed` |
| API golden path (Next dev + worker + mock provider) | Pass: create → discovery → approve → Temporal build → artifacts/files → ZIP → delete |

The local containers were stopped after verification; volumes were preserved.


## Known open defects (reported by the maintainer, 2026-10-26)

Confirmed at `fa285a2`. Root cause and remedy are specified in
`docs/plans/NEXT_PHASE_PLAN.md`.

**Status: fixed in D1 (2026-10-26).** Kept here as the record of what was
wrong; see `docs/plans/NEXT_PHASE_PLAN.md` for the delivery record.

| Symptom | Root cause | Location |
|---|---|---|
| Build fails after ~15 minutes | `startToCloseTimeout: "15 minutes"` on tool-node activities; `heartbeatTimeout` only 2 minutes; workflow ceiling 2 hours | `src/temporal/workflows/hcrWorkflow.ts:29-42`, `src/temporal/runtime.ts:58` |
| Frontend engineer fails after producing 38 files | Tool nodes capped at `maxIterations: 20`; one file per turn needs ~38 turns. Exhaustion throws and marks the node FAILED | `src/cognition/agent-registry.ts:89,105`, `src/cognition/node-executor.ts:268,397` |
| Retry re-runs the whole graph and re-pays for 6–7 artifacts | A retry always creates a new Workflow + Execution + `Node(ARCHITECT, order 1)`, so there is no resumable position | `src/runtime/workflows/hcr/start-hcr-workflow.ts`, `app/api/projects/[id]/retry/route.ts` |

Measured real-model node durations with `glm-5.3-flash`: ARCHITECT 16s,
RESEARCH 71s, PRD_REVIEWER 51s, PLANNER 67s, BACKEND_ENG 84s, FRONTEND_ENG
105s.

## Agent configuration and the shared agent turn (D2, 2026-10-27)

- `src/hcr/agent-config` is the single source of truth for the six agents.
  Prompts are versioned (`AGENT_PROMPTS` with id/version/hash), the config
  contract carries `prompt`, `outputContract`, and a required `version`, and
  every configuration is validated with Zod at catalog build and on each
  provider resolution.
- `AGENT_REGISTRY` is now a derived workflow view: instructions, limits, and
  output contracts come from `AGENT_DEFINITIONS`; only node-level context
  policy is declared there.
- `src/hcr/agent-turn` is the reusable loop (structured output and tool
  turns) with model, tool-runner, and event adapters. It owns output
  validation/retry, tool allow-listing, iteration and wall-clock bounds, and
  the continue/finish decision. Fake adapters cover it in unit tests.
- `executeNode` resolves and validates the config before any model call,
  records `Node.agentConfigVersion` + `Node.agentConfigHash`, and emits both
  in `node.running`.
- Context policy still belongs to the Context Engine (D3); agent configuration
  declares the output contract, not retrieval rules.

## Context Engine V2 (D3, 2026-10-27)

- `buildContext` now returns `{ messages, sources, facts, budget, fingerprint }`.
  Every considered source has a provenance reference (kind, id, label,
  version/updatedAt, status, priority, inclusion, drop reason); content never
  enters the manifest.
- Retrieval covers artifacts, project files, semantic files, message history,
  verification reports, prior failures, and curated project memory. The last
  three are opt-in policy flags (`includeVerification`, `includeFailures`,
  `includeMemory`).
- Conversation facts pin intent, unresolved questions, and pending approvals
  so compaction cannot lose them.
- A deterministic selection pass ranks sources, deduplicates them, enforces a
  token budget (`CONTEXT_TOKEN_BUDGET`, default 60k, 4 chars/token), and
  compacts with explicit `=== CONTEXT NOTES ===` omissions. Required sources
  are never truncated; overflow is reported.
- Node execution emits `context.assembled` with the fingerprint, budget
  report, and source references, so the same durable state is reproducible
  across worker restarts.
- The six HCR agents keep their existing context shape (V2 flags off, large
  default budget); parity is locked by tests.

## Layered memory and curation (D4, 2026-10-27)

- `MemoryEntry` stores episodic, semantic, procedural, and preference memory
  with kind, scope, subject, content, provenance, confidence, supersession,
  expiry, and a pgvector embedding. Working memory stays ephemeral in the
  context engine (scratchpad/tool history).
- Curation is deterministic and bounded: project memory, latest verification
  per command, recent executions, and user preference messages become
  candidates; no model call is involved.
- Conflicts follow a documented policy: identical content is a no-op, an
  active user correction outranks curated memory, and otherwise the newer
  entry supersedes the older one with a `supersededById` link.
- Episodic entries expire (`MEMORY_EPISODIC_RETENTION_DAYS`, default 90 days);
  pruning soft-deletes and clears vectors. Subject deletion removes every
  version and clears embeddings.
- `memoryCurationWorkflow` runs as a separate Temporal workflow after build
  finalize and after discovery. Its failure cannot fail a build.
- The Context Engine retrieves layered memory (vector matches first, then
  recent/confident entries) and falls back to the legacy `ProjectMemory`
  summary before curation has produced rows.

## Model router and usage budgets (D5, 2026-10-27)

- `src/providers/catalog.ts` declares every candidate as `provider:model`
  with locality, context window, max output, and capabilities. Context comes
  from `MODEL_CONTEXT_WINDOW` or per-provider overrides; model lists,
  fallbacks, and profile routes come from env.
- `routeModel()` is deterministic: explicit request, task profile
  (`reasoning`/`planning`/`implementation`), `MODEL_FALLBACKS`, provider
  default, catalog. Each candidate carries `eligible` plus a reason
  (`local_only`, `unconfigured`, `tools`, `json`, `context_window`,
  `circuit_open`, `fallback_disabled`).
- `MODEL_LOCAL_ONLY=true` drops every remote candidate before selection. It
  also overrides a remote `MODEL_PROVIDER`, and an environment with no local
  endpoint fails closed with `NoEligibleModelError` instead of emitting to
  remote.
- `callRoutedChat`/`callRoutedEmbeddings` dispatch only after routing, retry
  classified transient failures within a candidate (`MODEL_MAX_ATTEMPTS`),
  then walk fallbacks. `index.ts` public calls use the same path.
- The per-process circuit breaker (`health.ts`) opens after
  `MODEL_CIRCUIT_FAILURES` and skips the provider for
  `MODEL_CIRCUIT_COOLDOWN_MS`. It is intentionally in-process; restart resets
  it.
- Token ceilings are model-aware: `maxPromptTokensFor` subtracts required
  output and safety margin. `assertModelTokenBudget` enforces the optional
  per-execution `RUN_TOKEN_BUDGET` against provider-reported usage.
- `model.routed` records the decision, candidate reasons, locality, and
  estimates (never prompts). `model.routing_failed` records the failure class
  or candidate list. `model.usage` adds optional flat-rate
  `estimatedCostUsd` from `MODEL_INPUT_COST_PER_1K_USD` /
  `MODEL_OUTPUT_COST_PER_1K_USD`.
- `/api/health` exposes `routing` and `providerHealth`; Settings renders the
  live route, egress state, prompt ceiling, candidate reasons, and breaker
  state. `bun scripts/verify-routing.ts` is the no-network acceptance drill.

## Derived cache (D6, 2026-10-27)

- `src/runtime/cache` owns all derived-value caching. Keys are SHA-256
  digests of namespace, scope (`projectId`, `userId`, `agentType`,
  `configHash`, `providerId`, `modelId`), source version, and source
  identity; raw source content and prompts are never part of a key.
- Reads check a bounded in-process LRU (`CACHE_HOT_ENTRIES`) before the
  durable `DerivedCache` row, and write both on a miss. Expired entries are
  ignored. Concurrent misses for one key share a single load.
- Any durable read/write failure, invalid value, or disabled cache falls
  through to the loader; failures increment metrics only. A poisoned or
  malformed value is rejected by the caller's validator and reloaded.
- Embeddings are the first consumer. `lib/embeddings.ts` scopes vectors by
  project and by `ModelProvider.embeddingModelId`, so switching provider or
  embedding model misses the old entry. `CACHE_EMBEDDING_TTL_DAYS` controls
  retention; `CACHE_DISABLED` bypasses storage.
- Prompt embeddings record `cache.lookup` with namespace, outcome, and key
  digest (no content). File and memory embeddings contribute metrics only.
- Provider-native prompt-cache usage is normalized into
  `ChatUsage.cachedPromptTokens` (OpenRouter/RunAnywhere
  `prompt_tokens_details.cached_tokens`); `model.usage` adds
  `cachedPromptTokens` and `promptCacheSource` (`provider` or `unsupported`).
  Ollama exposes no equivalent and reports `unsupported`.
- Project deletion clears hot entries immediately and relies on the
  `DerivedCache` FK cascade for durable rows. `pruneExpiredCache()` is the
  hook for the D10 maintenance workflow.
- `/api/health` exposes `cache`, and Settings renders enabled state, hot
  entries, and per-namespace hit/miss/failure/write counts.
- `bun scripts/verify-cache.ts` is the no-network acceptance drill;
  `tests/cache.test.ts` covers scoping, TTL, invalidation, validation,
  failure fallback, and concurrent loads.

## Not yet verified


- Real Ollama/OpenRouter model quality and latency.
- Browser-level E2E (the API golden path is verified; the UI is built but not
  driven by Playwright yet).
- Worker-restart-during-activity drill.
- Durable cache behavior against a real Postgres and under multi-process
  workers; unit tests and the drill use the in-memory adapter.
- Verification sandbox (build/test execution). Structural checks only today.
- Desktop packaging and REA/Alan feature-gap evidence.

These are the next verification gates; do not claim them until they run.

## Known remaining work

- Integration and Temporal test suites.
- Verification workflow/sandbox (the `VerificationReport` model exists; the
  runner does not).
- Bounded repair workflow.
- Model-assisted memory extraction (D4 curation is deterministic).
- Scheduled cache pruning and cache-refresh maintenance (D10).
- Desktop shell packaging.
- REA/Alan feature-gap matrix (evidence not collected yet).