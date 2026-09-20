# HCR Temporal Verification & Equivalence

Branch: `phase/hcr-verification` (from Agent 03 `00e7f25`)
Scope: verification only. No production HCR/Inngest behavior changed, no Prisma
schema change, no UI change. Only narrow testability hook + tests + this doc.

## 1. Environment / commit tested

- Base: `phase/hcr-first-node-adapter` commit `00e7f25`
  (merges map `b7644aa` + contract `9fbae4e` via `0d9d309`).
- Verification adds: `isHcrDomainFailure` pure helper
  (`src/temporal/contracts/hcr.ts`), activity uses it
  (`src/temporal/activities/hcrActivities.ts`), offline suite
  (`tests/hcr-temporal-verification.test.ts` + `tests/bun-test.d.ts`).
- Toolchain: `bun test v1.3.11`, `bunx tsc --noEmit --strict` → clean.
- NOT executed (per owner instruction: typecheck-only, no Docker/servers):
  live Temporal worker, pilot workflow, HCR workflow with real LLM/DB.
  Runtime scenarios below are specified with exact commands for owner
  execution; results recorded as PENDING, never claimed.

## 2. Comparison model (product boundary)

| Dimension | Inngest reference | Temporal slice | Verdict |
|---|---|---|---|
| Project association | `projectId` threaded chat→events | `identity.projectId` threaded validate→activity→result | EQUIVALENT (static) |
| Workflow identity | `workflowId` per `startHCRWorkflow` | same `workflowId` passed through; Temporal run is `hcr-<executionId>` | EQUIVALENT w/ noted dedup decision (see §6 M1) |
| Execution identity | `executionId` per trigger | same `executionId`, no new rows created by Temporal | EQUIVALENT (static) |
| Node identity | `nodeId` ARCHITECT order:1 | same `nodeId`, type-guard ARCHITECT | EQUIVALENT (static) |
| Execution state | CREATED→RUNNING→COMPLETED/FAILED | same transitions via reused `executeNode` | EQUIVALENT by construction (runtime PENDING) |
| Node state | CREATED→RUNNING→COMPLETED/FAILED | same via reused `executeNode` | EQUIVALENT by construction (runtime PENDING) |
| Artifacts | versioned, `nodeId` reuse | same `createArtifact` path, same reuse | EQUIVALENT by construction (runtime PENDING) |
| Runtime events | running/completed/artifact.created | same emits (suppression affects only `node/completed` Inngest send) | KNOWN GAP on retry (see §6 M2) |
| Messages | USER/BUILD write once, FE/BE read | untouched (ARCHITECT passes `messages:[]` in both paths) | EQUIVALENT |
| Correlation | IDs + prompt in every event | IDs + prompt in workflow I/O + result | EQUIVALENT (static) |
| Failure | FAILED + 3 events via `handleFailure` | domain failures non-retryable; transport retried ×3 | PARTIAL — workflow-level FAILED marking absent (see §6 M3) |
| Retry | Inngest `retries:3` | Temporal `maximumAttempts:3` | PARITY by config (effect PENDING runtime) |

## 3. Scenarios

### S1. Happy path — Temporal ARCHITECT completes with artifact
- Expected: `validateHcrContext` OK → `runArchitectNode` returns
  `{nodeMigrated:true, artifactId, artifactType:ARCHITECTURE_SPEC}`; DB shows
  execution/node RUNNING→COMPLETED, one new artifact version, `node.completed`
  + `artifact.created` events; NO `node/completed` Inngest send.
- Observed (static): code path traced — activity calls `executeNode` with
  identical registry config, `emitCompletionEvent:false` skips only the send;
  workflow returns artifact correlation. `bun test` covers contract/registry
  parity (9 pass). Live run NOT executed.
- Observed (runtime 2026-09-20, owner-executed): **PASS.** Temporal run
  `a78e195b-d8fa-4527-8919-5b2b491be980` (`hcr-cmu9x8vfx002xx2z1ya8sdw1b`,
  prompt "build with approved scope") completed `WorkflowExecutionCompleted`
  in 17 events: `validateHcrContext` attempt 1 (~2.3s) → `runArchitectNode`
  attempt 1 (~40s) → artifact `cmu9x9t0y0002s3z1en37mkf7`
  (`ARCHITECTURE_SPEC`, `nodeMigrated:true`). Full trace archived at
  `d-2/hcr/temporal_ui_events/a78e195b-d8fa-4527-8919-5b2b491be980_events.json`.
  Timeouts/retries match design (`30s×3` / `300s×3`). Prior failed attempt on
  the same chain (stale worker `MODEL` env, since fixed by worker restart)
  doubles as S4 partial evidence — confirm its `workflow.failed` reason via
  `GET hcr` to close S4.
- Classification: pass with evidence (runtime); S4 partial, pending reason
  confirmation.
- Owner command:
  ```
  docker compose -f docker-compose.temporal.yml up -d
  bun run temporal:worker   # in a second terminal
  # trigger hcrWorkflow with a real {identity, prompt, inputArtifactId:null}
  # via a temporary authenticated route or script (cutover is Agent 05 scope;
  # do NOT point POST /chat at Temporal yet)
  ```

### S2. Duplicate trigger — same logical execution started twice
- Expected (parity): Inngest has NO dedup — each trigger creates new rows.
  Temporal workflow ID `hcr-<executionId>` is deterministic per execution, so a
  same-`executionId` repeat maps to one Temporal run instead of forking.
- Observed (static): `buildHcrWorkflowId` deterministic + execution-scoped
  (3 tests pass); `validateHcrContext` re-reads same rows idempotently.
  Live double-start NOT executed.
- Classification: intentional Temporal semantic difference (dedup at Temporal
  layer, none at Inngest layer). Cutover trigger must decide: new executionIds
  (parity) vs ID reuse (fork-prevention). Left for Agent 05.
- Owner command: start `hcrWorkflow` twice with identical input; confirm single
  Temporal run (`hcr-<executionId>`) and single artifact per `nodeId`.

### S3. Activity retry — transient failure does not duplicate product state
- Expected: artifact single per `nodeId` (existing reuse); no duplicate
  `ARCHITECTURE_SPEC` version on retry.
- Observed (static): reuse path `artifact.findFirst({nodeId})` shared by both
  orchestrators (same code). KNOWN GAP: `execution.running` / `node.running` /
  `node.completed` events are unconditional creates → retry duplicates events
  while artifact stays single. Deliberately unfixed (changing it would alter
  Inngest behavior). Live retry NOT executed.
- Classification: pre-existing behavior (Inngest retries duplicate events the
  same way) + test harness pending.
- Owner command: induce transient DB error on first attempt (e.g. brief proxy
  kill between validate and node activity), let Temporal retry, then count
  `artifact where nodeId` (=1) vs `runtimeEvent node.completed` (may be 2).

### S4. Terminal failure — invalid identity / exhausted LLM validation
- Expected: `HcrMissingPrompt` / `HcrNodeNotFound` / `HcrWrongNodeType` /
  `HcrDomainFailure` surface as non-retryable; record stays inspectable
  (execution/node NOT silently marked COMPLETED).
- Observed (static): classifier unit-tested (JSON-exhausted/missing → true;
  transport/empty → false; 4 tests pass). NOTE: unlike Inngest `onFailure →
  handleFailure` (FAILED + 3 events), the Temporal slice does NOT yet write
  FAILED statuses — failure surfaces to the workflow caller with no
  `workflow.failed` row update. Live failure NOT executed.
- Classification: implementation gap (M3 below), severity medium.
- Owner command: trigger with unknown `executionId`; expect fast non-retryable
  `HcrExecutionNotFound`, no partial artifact.

### S5. Worker restart — durable resume
- Expected: restart between validate and node activity resumes without
  re-running completed Activities; `hcr-<executionId>` reattaches.
- Observed: NOT executed (no server per owner rule). By design Temporal
  replays workflow history; activities are idempotent reads or nodeId-keyed
  writes. No evidence collected — do not claim.
- Classification: test harness issue (environment unavailable in this task).
- Owner command: start workflow, `docker stop` worker mid-`runArchitectNode`,
  restart `bun run temporal:worker`, confirm completion with single artifact.

### S6. Existing pilot regression — greet + pilot still functional
- Expected: `greetWorkflow`/`pilotWorkflow` exports, registrations, and
  `pilot-queue` task-queue agreement unchanged.
- Observed (static): both still exported in `workflows/index.ts` and registered
  in `worker.ts`; `tsc` clean; `bun test` suite green. TASK-QUEUE FIX VERIFIED
  STATICALLY: worker now reads `TEMPORAL_TASK_QUEUE ?? "pilot-queue"`,
  matching `app/api/temporal/pilot/route.ts`. Live `bun run temporal:hello`
  NOT executed per owner rule.
- Classification: test harness pending (one-command owner check below).
- Owner command:
  ```
  docker compose -f docker-compose.temporal.yml up -d
  bun run temporal:worker
  bun run temporal:hello   # expect: Hello, World from Temporal!
  ```

### S7. Inngest reference path — untouched baseline
- Expected: Inngest ARCHITECT flow byte-identical to pre-migration.
- Observed (static): default `emitCompletionEvent:true` preserves both
  `inngest.send` call sites; `git diff` on `node-executor.ts` shows only the
  flag + two guards; all 6 node wrappers + coordinator unmodified; no schema,
  UI, prompt, or memory changes. Inngest E2E NOT re-run here.
- Classification: equivalent by construction (reviewable diff).

## 4. Evidence / IDs

- Offline: `bun test tests/hcr-temporal-verification.test.ts` → 9 pass,
  0 fail, 18 expects. `bunx tsc --noEmit --strict` → clean.
- Commits: `b7644aa` (map) / `9fbae4e` (contract) / `00e7f25` (adapter) /
  verification commit (this task: hook + tests + doc).
- Correlation available at runtime (not yet instantiated): Temporal
  `workflowId=hcr-<executionId>`, run ID from `wf.workflowInfo()`, Doable
  `workflowId/executionId/nodeId`, `artifactId`, `artifactType`,
  `runtimeEvent` IDs. No secrets/tokens/prompts logged by harness.
- Live IDs recorded 2026-09-20 (S1 runtime PASS): Temporal workflow
  `hcr-cmu9x8vfx002xx2z1ya8sdw1b`, run
  `a78e195b-d8fa-4527-8919-5b2b491be980`, Doable project
  `cmu9x6q8x002dx2z1fjcwzomt` / workflow `cmu9x8v7d002wx2z179dkbmjm` /
  execution `cmu9x8vfx002xx2z1ya8sdw1b` / node `cmu9x8voi002yx2z1b2e17yoa` /
  artifact `cmu9x9t0y0002s3z1en37mkf7` (`ARCHITECTURE_SPEC`). Trace:
  `d-2/hcr/temporal_ui_events/a78e195b-d8fa-4527-8919-5b2b491be980_events.json`.
  Standing follow-up: confirm this execution has no `RESEARCH` node (no
  Inngest fan-out) and capture the prior stale-`MODEL` run's
  `workflow.failed` reason to close S4.

## 5. Mismatches

- M1 — Duplicate-trigger semantics differ (Inngest forks, Temporal
  `hcr-<executionId>` dedups). Class: intentional Temporal semantic
  difference. Severity: low for slice (no cutover yet), must-decide at Agent 05.
- M2 — Retried activity duplicates `running/completed` events (artifact stays
  single). Class: pre-existing behavior (both orchestrators share the code).
  Severity: low-medium; acceptable for first slice, must document in UI
  event-stream expectations before migrating FE/BE.
- M3 — Temporal terminal failure does not write FAILED statuses
  (`handleFailure` is Inngest-`onFailure`-only). Class: implementation gap.
  Severity: medium; failed Temporal runs leave execution RUNNING with no
  `workflow.failed` row until compensated.
- M4 — Runtime evidence partially recorded (S1 live PASS 2026-09-20, trace
  archived; S4 partial via stale-`MODEL` failure). Class: test
  harness issue (owner-reserved validation). Severity: still gate-blocking
  for S2/S3/S5/S6 by rule ("no parity from compilation alone").

## 6. Required fixes before the next migration (ordered)

1. Owner-executed runtime pass of S1–S6 with IDs pasted into §4; any
   divergence re-classified before Agent 05 cutover design.
2. Decide M1 trigger policy for cutover (new executionIds vs ID reuse +
   `WorkflowIdReusePolicy`).
3. Add Temporal failure compensation (M3): on terminal activity failure, run a
   `markHcrFailed` activity mirroring `handleFailure` rows (or explicitly defer
   with owner sign-off — project stays IN_PROGRESS today even on Inngest).
4. Before FE/BE slices: design `toolCallId`-keyed file-write idempotency (map
   §13 gap carries forward; ARCHITECT slice is unaffected).

## 7. Gate recommendation — FAIL (conditional, evidence-gated)

Static equivalence passes (contracts, registry, transitions, classifier,
task-queue cleanup, Inngest parity by construction; 9/9 offline tests, clean
typecheck). Runtime parity is NOT demonstrated — no live workflow, retry,
failure, restart, or pilot run was executed in this task (forbidden by owner
typecheck-only rule, and phase rules forbid declaring parity from compilation).

The slice is SAFE as the foundation for the next node adapter (narrow,
revertible, Inngest path untouched) but NOT YET approved for cutover. Promote
to PASS only after §6.1 runtime evidence is recorded and M1/M3 decisions are
signed off. No mismatches were silently fixed; all are classified above.
