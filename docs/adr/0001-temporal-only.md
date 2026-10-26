# ADR-0001 — Temporal is the only orchestrator

- **Status:** Accepted
- **Date:** 2026-10-26
- **Supersedes:** the dual Inngest/Temporal migration state

## Context

The repository carried two orchestration paths: an Inngest production path and
a Temporal full-graph migration path. Both wrote the same Postgres state, had
duplicate failure writers, and could fork sequencing if both were active. The
product needs durable long-running builds, retries, heartbeats, cancellation,
and recovery.

## Decision

Temporal owns workflow durability and sequencing. Doable owns cognition,
context, tools, prompts, provider routing, and product state.

- `POST /api/projects/[id]/chat` and the explicit diagnostic trigger call
  `startBuild` in `src/temporal/runtime.ts`.
- Temporal activities own all non-deterministic I/O: Postgres, files, models,
  embeddings.
- Inngest route, functions, package, environment configuration, and event types
  are removed.
- The worker uses `TEMPORAL_TASK_QUEUE` (default `pilot-queue`).
- Build start is idempotent at the product level through a conditional
  `PENDING|IDLE → IN_PROGRESS` update in `startHcrRun`.
- Failure/success/cancel transitions go through `src/runtime/state`.

## Consequences

- Operating the app locally requires a Temporal service and worker.
- Workflow code must stay deterministic; new I/O belongs in activities.
- A failed Temporal start marks the run and project recoverable instead of
  leaving `IN_PROGRESS` forever.
- Embeddings are no longer an Inngest job; they run through
  `src/runtime/embeddings` and degrade semantic search on failure.

## Alternatives considered

- **Keep Inngest:** lower operational overhead, but retains the duplicate path
  and does not meet the durable-orchestration requirement.
- **Dual-run:** rejected because both paths can mutate the same execution and
  create duplicate nodes/artifacts.