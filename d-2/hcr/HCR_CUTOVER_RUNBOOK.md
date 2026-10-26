# HCR Cutover Runbook — Agent 05 (Cutover / Decommission Preparation)

Branch: `phase/hcr-cutover` (from verification `456df02`)
Status: cutover-prep only. Production `POST /chat` still fires Inngest.
No Inngest code deleted, renamed, or unregistered. No schema change.

## 1. What this task delivers

| Piece | File | Notes |
|---|---|---|
| Failure compensation | `src/temporal/activities/hcrActivities.ts` (`markHcrFailed`) | Mirrors `lib/handleFailure` rows/events; idempotent conditional writes; Temporal-tagged payloads; leaves `Project` at `IN_PROGRESS` like Inngest parity |
| Workflow catch path | `src/temporal/workflows/hcrWorkflow.ts` | Node-activity exhaustion → `markHcrFailed` (single attempt, 30s) → rethrow; validation failures skip compensation (nothing ran) |
| Compensation contract | `src/temporal/contracts/hcr.ts` | `MarkHcrFailedActivityInput/Result` |
| Isolated trigger | `app/api/temporal/hcr/route.ts` | `POST /api/temporal/hcr {projectId, prompt, inputArtifactId?}` → creates the same Message + Workflow/Execution/ARCHITECT chain as `/chat`, sets `IN_PROGRESS`, starts `hcr-<executionId>`; never sends `node/execute` |
| This runbook | `d-2/hcr/HCR_CUTOVER_RUNBOOK.md` | Procedure below |

Untouched by design: `app/api/projects/[id]/chat/route.ts`,
`app/api/inngest/route.ts`, every file under `app/inngest/`,
`src/cognition/*` prompts/registry, `prisma/*`, UI. The worker needed no
change — `markHcrFailed` ships inside the already-registered `hcrActivities`
module on the shared `TEMPORAL_TASK_QUEUE ?? "pilot-queue"`.

## 2. Inngest retention guarantee (read before worrying)

- All 9 Inngest functions remain registered in `app/api/inngest/route.ts`
  (including the dead `hcr-agent` reference).
- `POST /chat` behavior is byte-identical: same gating, same rows, same
  `node/execute` fire. Existing callers see zero change.
- "Safely retired" in this phase means: Temporal path available side-by-side
  for explicit checks; Inngest remains the production path until a later,
  explicitly approved cutover PR repoints `/chat` (or a flag) at Temporal.
- Rollback is trivial (see §5) because nothing was removed — there is no
  legacy code to restore.

## 3. Full-fledged ARCHITECT check (owner-executed)

Prereqs: Postgres reachable (`DATABASE_URL`), OpenRouter key (`OPENROUTER_API_KEY`
+ `MODEL`), Temporal up, worker running, a project in `PENDING` or `IDLE`
with a `DISCOVERY_REQUIREMENT` artifact (ARCHITECT consumes the latest one).

```bash
# 1. Temporal backend (~30-60s to healthy)
docker compose -f docker-compose.temporal.yml up -d
docker compose -f docker-compose.temporal.yml ps

# 2. Worker (second terminal; serves pilot + HCR on the same queue)
bun run temporal:worker

# 3. App (third terminal)
bun dev
```

Trigger (authenticated — use the dashboard harness or browser fetch with your
Clerk session; raw curl needs a session token):

```json
POST http://localhost:3000/api/temporal/hcr
{ "projectId": "<project-id>", "prompt": "<same prompt you would POST to /chat>" }
```

Expect `201`:

```json
{
  "temporalWorkflowId": "hcr-<executionId>",
  "temporalRunId": "<run-id>",
  "doableWorkflowId": "<workflow-id>",
  "doableExecutionId": "<execution-id>",
  "doableNodeId": "<node-id>",
  "messageId": "<message-id>",
  "status": "started"
}
```

Then verify (all IDs from the response above):

1. `GET /api/projects/[id]/hcr` → execution `RUNNING` → node `ARCHITECT`
   `COMPLETED`; exactly one `ARCHITECTURE_SPEC` artifact (new version);
   events contain `workflow.created`, `execution.created`, `node.created`,
   `execution.running`, `node.running`, `artifact.created`, `node.completed`.
2. No `node/completed` Inngest fan-out happened for this execution (no
   `RESEARCH` node appears) — Temporal owns sequencing now.
3. Failure drill (optional but recommended): trigger with a prompt that forces
   exhausted JSON validation, or stop the worker mid-activity and restart —
   expect `workflow.failed` / `execution.failed` / `node.failed` (Temporal
   source-tagged) on exhaustion, and single-artifact resume on restart.
4. Pilot regression: `bun run temporal:hello` → `Hello, World from Temporal!`.

Record every ID back into `HCR_TEMPORAL_VERIFICATION.md` §4 and flip its gate
per evidence. If anything crashes, keep the Temporal Web UI
(`http://localhost:8080`, workflow `hcr-<executionId>`) output and ask —
do not "fix forward" inside this branch.

## 4. Pass criteria for the first workflow

- One trigger → one `ARCHITECTURE_SPEC` version, correct schema
  (`ArchitectureSpecSchema`), node `COMPLETED`, workflow result
  `{nodeMigrated:true, artifactId, artifactType, nodeType:ARCHITECT}`.
- Retry drill → still one artifact for the `nodeId` (events may duplicate —
  known M2, pre-existing on both orchestrators).
- Terminal drill → FAILED rows + 3 events, Temporal run failed, no partial
  artifact, project left `IN_PROGRESS` (parity with Inngest).
- Pilot + Inngest reference path unaffected.

Full-graph extension (`phase/hcr-full-graph`, same trigger): one trigger →
`ARCHITECTURE_SPEC → RESEARCH_DOSSIER → APPROVED_PRD → EXECUTION_PLAN` (one
version each) → FE/BE file mutations → `project IDLE`; exactly one artifact
per `nodeId`; no `node/completed` Inngest fan-out for the execution (no
duplicate nodes beyond the Temporal-created ones); workflow result lists
`nodesCompleted` + per-node `artifacts`.

## 5. Rollback (any doubt → do this, in order)

1. Stop calling `POST /api/temporal/hcr`. Production `/chat` never changed,
   so Inngest keeps serving all real traffic.
2. Stop the Temporal worker (`Ctrl+C`); optionally
   `docker compose -f docker-compose.temporal.yml down`. App/DB untouched.
3. For any half-finished Temporal execution: inspect via `GET hcr` route;
   delete its `Workflow` row (cascades to executions/nodes/events/artifacts)
   or leave it — it never touches Inngest rows. Flip the project back to
   `IDLE` if a `503` orphan left it `IN_PROGRESS`:
   `project.update({status:IDLE})` for that project only.
4. To revert code: `git checkout phase/hcr-verification` (or delete this
   branch). Nothing else references the new route/activities.

## 6. Full-migration plan (after ARCHITECT passes §4)

> Addendum (`phase/hcr-full-graph`): per-node code branches were consolidated
> into one `src/temporal/**`-only branch because every node shares the
> identical wrap pattern (zero cognition changes — the Agent 03 suppression
> flag covers all modes). Implemented: generic `runHcrNodeActivity`
> (`runArchitectNode` now delegates, behavior unchanged), coordinator port
> (`createNextHcrNodes` + guarded `finalizeHcrSlice`), workflow loop over
> `HCR_TRANSITION_MAP` with FE/BE `Promise.all` fan-out and single finalize
> call, `POST /api/temporal/hcr` unchanged. Per-node verification continues
> checkpoint-by-checkpoint in the final run below; Inngest diff remains zero.

1. `RESEARCH` (+ `RESEARCH_DOSSIER`), 2. `PRD_REVIEWER`, 3. `PLANNER`
   (staff-engineer), 4. `FRONTEND_ENG` + `BACKEND_ENG` together (tool-call
   path needs `toolCallId`-keyed file-write idempotency first — map §13 gap),
5. coordinator port (transition-map as workflow logic + parallel join),
6. explicit cutover PR repointing `/chat` (or a `HCR_ORCHESTRATOR` flag) with
   the M1 trigger-policy decision (new executionIds for parity vs ID reuse
   for fork-prevention), 7. Inngest decommission: unregister from the
   production path only — code stays as legacy/reference/rollback.

## 7. Open decisions (unchanged, for sign-off)

- M1 trigger dedup (§6 of verification doc): new executionIds (parity) vs
  `hcr-<executionId>` reuse (fork-prevention) at final cutover.
- Failed runs leave `Project` at `IN_PROGRESS` on both orchestrators —
  confirm whether a future cutover should finally drive it to `FAILED`/`IDLE`.
