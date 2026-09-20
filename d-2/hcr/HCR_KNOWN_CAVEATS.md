# HCR Known Caveats — Parked for Future Scope

Source: read-only review of the current codebase (`app/inngest`, `src/cognition`,
`src/runtime`, `src/temporal`, `lib/*`) plus migration evidence
(`HCR_MIGRATION_MAP.md`, `HCR_TEMPORAL_VERIFICATION.md`, Temporal trace
`temporal_ui_events/a78e195b…_events.json`).

Rule for this file: the Temporal wrap replicates Inngest semantics
(durability + retryability) and intentionally fixes **none** of the items
below. Each item records *where*, *impact*, and *what a future fix needs*.
No action until a dedicated scope + owner sign-off exists.

## 1. Dedup / idempotency gaps

- **C1 — No trigger dedup.** Every `POST /chat` (or `/api/temporal/hcr`) that
  passes the `PENDING|IDLE` check creates a new Workflow/Execution/Node chain,
  even for identical prompts. Two concurrent POSTs can both pass the check
  (no row lock / transaction around check-then-create). Future: idempotency
  key on trigger (e.g. client-supplied key or `hcr-<executionId>` reuse
  policy) + DB-level guard.
- **C2 — Retry duplicates runtime events.** `execution.running`,
  `node.running`, `node.completed` are unconditional `create`s, so any
  orchestrator retry (Inngest or Temporal) duplicates events while the
  artifact stays single (artifact reuse by `nodeId`). Pre-existing on both
  paths. Future: conditional event writes or dedup on read.
- **C3 — Coordinator re-execution forks the graph.** `workflow-coordinator`
  creates next `Node` rows + fires `node/execute` with no idempotency key, so
  a duplicate `node/completed` delivery creates duplicate next nodes and
  duplicate downstream runs. Same applies to the ported Temporal coordinator
  activities until keyed creation is added. Future: `(executionId, order,
  type)` dedup key around node creation.
- **C4 — Artifact `nodeId` reuse has no unique constraint.** The
  find-then-create in `executeNode` races under concurrent duplicate delivery.
  Future: `@@unique` on `Artifact.nodeId` (nullable-safe) or conditional
  create; needs a migration + backfill check.
- **C5 — FE/BE file writes are not idempotent.** `create_file` retries can
  duplicate files; `edit_file` with `old_str=""` does full rewrites. No
  `toolCallId` dedup. Future: stable tool-call keys + existence checks before
  write. Flagged before any FE/BE production cutover.
- **C6 — Two failure writers can diverge.** `lib/handleFailure` (Inngest) and
  `markHcrFailed` (Temporal) implement the same semantics in two places.
  Future: single shared helper used by both (mechanical, needs parity test).

## 2. Failure / stuck-state gaps

- **C7 — Failed runs strand projects at `IN_PROGRESS`.** Neither failure path
  resets `Project` status. No sweeper, no alert. A failed project can never
  restart HCR (gate requires `PENDING|IDLE`) without manual DB edit. Future:
  decide terminal project state (`FAILED` vs back to `IDLE`) + sweeper.
- **C8 — Trigger-side orphans.** If `inngest.send` (chat) or Temporal start
  (`/api/temporal/hcr` 503) fails after row creation, a `CREATED` chain +
  `IN_PROGRESS` project is left behind. Same manual cleanup. Future: trigger
  transactionality or async cleanup job.
- **C9 — Coordinator has no `onFailure`.** A coordinator crash leaves the
  execution mid-graph with no `FAILED` marking (unlike node functions).
  Future: failure hook + compensation mirroring `markHcrFailed`.
- **C10 — `onFailure` payload shape is fragile.** All node `onFailure`
  handlers destructure `event.data.event.data`; a shape mismatch throws
  inside the failure handler itself. Future: defensive parsing + test.
- **C11 — Tool path masks agent non-completion.** FE/BE force `COMPLETED`
  when the loop ends without `mark_complete`, so a giving-up agent looks
  successful. Future: distinguish `COMPLETED` vs `MAX_ITERATIONS_EXHAUSTED`.
- **C12 — Validation-failure rows sit at `CREATED` forever** (both paths, by
  design for inspectability). Same sweeper conversation as C7.

## 3. Performance / cost gaps

- **C13 — No LLM/embedding caching across nodes.** Each of the 6 nodes
  re-embeds the prompt and rebuilds context from scratch; sequential
  structured nodes each pay full price + up to 3 internal retries.
- **C14 — Context rebuilt per tool iteration.** FE/BE loops (≤20) call
  `buildNodeContext` every iteration, including file-tree + pgvector search
  each time. Future: cache static context per node, stream deltas.
- **C15 — No heartbeats on long activities.** `heartbeatTimeout: 0s`
  everywhere (see trace). A worker crash mid 40s–5min activity restarts the
  whole LLM call and repays the cost. Future: heartbeat long loops (FE/BE),
  shorter LLM steps.
- **C16 — No workflow-level timeouts.** Trace shows
  `workflowExecutionTimeout: null`, `workflowRunTimeout: null`. A wedged run
  lives forever. Future: explicit execution/run timeouts per node profile.
- **C17 — History bloat by value.** Prompts + artifact payloads travel inside
  workflow history (`historySizeBytes` 557 → 2942 in the ARCHITECT-only
  slice; full graph with `EXECUTION_PLAN` + file trees will be far larger).
  Future: pass artifact IDs, have activities re-read from Postgres.
- **C18 — N+1 write patterns.** Per-tool `runtimeEvent` creates, per-iteration
  reads, no batching. Fine at pilot scale; revisit with concurrency.
- **C19 — Unbounded fan-out.** No per-project or global concurrency caps on
  parallel FE/BE or concurrent triggers. Future: worker slots / semaphore.
- **C20 — Arbitrary truncation budgets.** Vector hits truncated to 700 chars,
  scratchpad to last 8, history to last 10 — untuned constants. Future:
  measure quality vs tokens per node.

## 4. Reliability / ops gaps

- **C21 — Worker env drift (bit us once).** `bun run temporal:worker` snapshots
  env at startup and ignores later `.env*` edits; Next hot-reloads them.
  Stale `MODEL` caused the first failed run. Future: single env source,
  startup env assertion in worker (fail fast listing missing keys, never
  values), document restart-on-env-change.
- **C22 — Shared `pilot-queue` for everything.** Pilot, HCR nodes, and future
  graphs share one queue — noisy-neighbor risk, no priority. Future: per-lane
  queues (`hcr-queue`, `pilot-queue`) + worker pools.
- **C23 — Stale scripts reference `greet-task-queue`.**
  `scripts/temporal-hello.ts` and `scripts/run-pilot-workflow.ts` hardcode the
  pre-cleanup queue and will miss the worker. Future: read
  `TEMPORAL_TASK_QUEUE` like the app routes do.
- **C24 — Single-point Temporal backend.** Local slim Postgres stack, no
  Elasticsearch visibility, no backup story. Fine for migration; production
  needs the full footprint + runbooks.
- **C25 — Dead `hcr-agent.ts` (`chat/requested`, no sender).** Retained as
  reference per phase rules. Future: explicit keep-or-delete decision at
  decommission, not before.
- **C26 — No CI test gate.** Only `bun test` run manually; nothing enforces
  `tsc` + tests on branches. Future: minimal CI (typecheck + bun test).

## 5. Observability gaps

- **C27 — Stale `executionStatus` in workflow result.** The result carries the
  pre-node validation snapshot (`CREATED` in the trace) while the node has
  since run. Cosmetic; callers must treat artifact/node IDs as truth until
  polished (re-read post-node or drop the field).
- **C28 — No ASSISTANT messages during HCR.** User-visible progress exists
  only via polling `GET hcr`. Future: progress messages or SSE.
- **C29 — Scratchpad/tool history not persisted.** FE/BE debugging context
  dies with the process; failures leave only events. Future: persist
  scratchpad per iteration (bounded).
- **C30 — No token/cost tracking.** No per-node/per-project LLM spend.
  Future: log usage from OpenRouter responses, roll up per execution.
- **C31 — Stringly-typed `RuntimeEvent.type`.** No enum; typos invisible to
  `tsc` (`tool.completed` vs `node/completed` confusion already exists
  across layers). Future: const union + exhaustiveness.

## 6. Schema opportunities (guarded — each needs its own migration + review)

- Unique constraint backing C4; event-type enum backing C31;
  `startedAt/finishedAt` on Execution/Node (durations today derive from
  `createdAt/updatedAt` only); terminal `ProjectStatus` handling for C7;
  optional persisted Temporal `workflowId/runId` columns (today correlation
  is `hcr-<executionId>` convention + workflow result, deliberately
  column-free per phase rules).
