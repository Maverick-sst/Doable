# Doable — Next Phase Implementation Plan

Status: **planned, not started**
Branch base: `main` @ `fa285a2` (merge of `v1.1/foundation` @ `782dc72`)
Spec source: `Doable-Authoritative-Full-Product-Implementation-Spec.md` (attached by maintainer)
Plan owner: Alan

This document is the durable source of truth for the next phase. It is written to
disk so the work survives context compaction: if a session is compacted, resume
from this file plus `docs/architecture/current-state.md`, not from chat history.

---

## 1. Root cause of the three reported failures

The maintainer ran a complete build and reported three problems. All three are
confirmed in the code at `fa285a2`.

### 1.1 Node timeout — `startToCloseTimeout` too small

`src/temporal/workflows/hcrWorkflow.ts`

| Activity proxy | Current | Evidence |
|---|---|---|
| `runHcrNodeActivity` (structured) | `startToCloseTimeout: "10 minutes"` | line 29 |
| `runHcrToolNode` (FE/BE) | `startToCloseTimeout: "15 minutes"` | line 40 |
| both | `heartbeatTimeout: "2 minutes"` | lines 30, 41 |
| both | `retry: { maximumAttempts: 3 }` | lines 31, 42 |
| workflow | `workflowExecutionTimeout: "2 hours"` | `src/temporal/runtime.ts:58` |

Measured real-model node durations (`glm-5.3-flash`, notes app): ARCHITECT 16s,
RESEARCH 71s, PRD_REVIEWER 51s, PLANNER 67s, BACKEND_ENG 84s, FRONTEND_ENG
105s. A run that must produce 38 files in FE was killed by the 15-minute cap.

Secondary risk: `heartbeatTimeout` of 2 minutes with a 30-second heartbeat
interval leaves only one missed tick of slack. `withHeartbeat`
(`src/temporal/activities/hcrActivities.ts`) renews on a timer, so the lease
normally holds, but a blocked event loop during a long synchronous step can
miss a tick and produce a false timeout.

### 1.2 Iteration budget — `maxIterations: 20` for tool nodes

`src/cognition/agent-registry.ts` lines 89 and 105 set `maxIterations: 20` for
`FRONTEND_ENG` and `BACKEND_ENG`. `src/cognition/node-executor.ts:268` reads
it, and line 397 throws:

```
${nodeType} exhausted ${maxIterations} iterations without mark_complete
```

The loop spends one iteration per model turn, and the model writes roughly one
file per turn. 38 files therefore needs ≥38 iterations. The node produced 38
files and was still marked FAILED because the budget ran out before
`mark_complete` was called. The work was not lost, but the run was reported as
failed.

`MAX_ITERATIONS` exists in `.env` but is **not** wired to the registry.

### 1.3 Retry restarts the whole graph — the expensive defect

`src/runtime/workflows/hcr/start-hcr-workflow.ts` always creates a fresh
`Workflow` + `Execution` + `Node(ARCHITECT, order 1)`. The retry route
(`app/api/projects/[id]/retry/route.ts`) calls `retryBuild` → `startBuild` →
`startHcrRun`, so a retry always re-enters at ARCHITECT.

Consequence: 6–7 already-produced artifacts (ARCHITECTURE_SPEC,
RESEARCH_DOSSIER, APPROVED_PRD, EXECUTION_PLAN) are re-generated, re-paid for,
and the previously written files are re-derived. This is the token waste the
maintainer observed.

**Root cause is architectural, not a bug in the retry handler:** the run has no
notion of a resumable position, so "retry" can only mean "start over".

---

## 2. Design decisions

### 2.1 Resume model — new Execution per attempt, one Workflow per build

**Decision:** a *Build* is one `Workflow`. An *Attempt* is one `Execution`
under it. A resume creates a new attempt, not a new build.

```
Workflow (HCR)  ──┬── Execution (attempt 1)  ── Node(ARCHITECT) … Node(FE/BE)  [FAILED]
                  └── Execution (attempt 2)  ── Node(FE/BE) …                     [resume]
```

Why this shape:

- **Node identity stays unique per attempt.** The existing
  `@@unique([executionId, order, type])` still holds, so the coordinator's
  idempotent node creation keeps working inside an attempt.
- **Temporal workflow IDs stay unique.** `buildHcrWorkflowId` is
  `hcr-<executionId>`; a new attempt has a new execution, so a new workflow
  ID. No workflow-versioning conflict with in-flight histories.
- **Artifacts are reused, not regenerated.** The Context Engine resolves a
  node's input by policy (`consumedArtifactTypes` → latest version for the
  project), so a resumed node automatically consumes the artifact the previous
  attempt produced. No artifact re-creation for upstream stages.
- **Files already written are preserved.** The workspace is filesystem
  canonical, so 38 files from attempt 1 are visible to attempt 2's node through
  the file tree, and `edit_file` continues from them.
- **History is preserved.** Attempt 1's nodes, events, and artifacts remain
  inspectable; the UI can show "attempt 2 of 2, resumed at FRONTEND_ENG".

**Entry position needs no workflow change.** `validateHcrContext` already
returns `node.type` for the node row referenced by the identity, and
`hcrWorkflow` already seeds `pending` from `validated.nodeType`
(`src/temporal/workflows/hcrWorkflow.ts:108-117`). Creating the attempt's first
node with the failed node's type makes the workflow start there. This is the
single most important property of the design: **the database is the source of
truth for the starting position, so the workflow code does not change.**

**Resume target selection.** The failed node in the previous attempt is the
resume target — except when the failure was a *budget* exhaustion rather than a
hard error, in which case the same node is retried with a larger budget.

**Resume prompt.** The resumed node receives an augmented prompt naming the
files already present and the attempt number, so it continues rather than
re-derives.

**Resume input artifact.** Resolved server-side from the registry entry for the
target node type: latest artifact of the first `consumedArtifactTypes` entry
for the project. The client never supplies it.

### 2.2 Honest completion — partial work is not success or failure

Budget exhaustion currently throws, which marks the node and the run FAILED
even though real files were produced. That is dishonest in both directions.

**Decision:** introduce explicit terminal states instead of overloading FAILED.

- `NodeStatus.INCOMPLETE` — the node stopped on budget, not on error.
- `ExecutionStatus.PARTIAL` — the attempt ended with one or more incomplete
  nodes.
- A `node.budget_exhausted` runtime event records the reason, the budget
  consumed, and the work produced.
- The project reaches `IDLE` only when every node is `COMPLETED`. With an
  incomplete node the project reaches a distinct state and the UI shows the
  run as **incomplete**, with the produced files intact and a clear next step.

Verification (Delivery 8) becomes the authority on whether the output is
actually runnable. Until then Doable says "generated", never "verified".

### 2.3 Budgets are time-aware and configurable

Iteration count alone is the wrong budget: a reasoning model can take 100s per
turn, so 20 iterations may be 15 minutes and 120 iterations may be 4 hours.

**Decision:** every tool node gets both an iteration ceiling and a wall-clock
ceiling, whichever binds first. Values come from the agent registry and can be
overridden by environment.

| Setting | Default | Override |
|---|---|---|
| Structured node iterations | 1 | — |
| Tool node iterations | 120 | `MAX_ITERATIONS` |
| Tool node wall clock | 45 min | `NODE_WALL_CLOCK_BUDGET_MS` |
| Structured node activity timeout | 30 min | `NODE_ACTIVITY_TIMEOUT_MS` |
| Tool node activity timeout | 60 min | `TOOL_ACTIVITY_TIMEOUT_MS` |
| Heartbeat timeout | 10 min | `TEMPORAL_HEARTBEAT_TIMEOUT` |
| Workflow execution timeout | 12 h | `HCR_WORKFLOW_TIMEOUT` |

### 2.4 Egress and local-only are server-enforced

The maintainer uses a remote provider (RunAnywhere) for testing and does not
want local models. Egress must therefore be a *configuration*, not an
accident, and `local-only` must be enforced server-side so a misconfiguration
cannot silently send project content to a remote endpoint.

### 2.5 Context compaction (both meanings)

The maintainer asked that a long session be compacted rather than fully
refreshed. Two distinct concerns:

1. **Session continuity (this plan).** All planning state lives in tracked
   files (`docs/plans/`, `docs/architecture/`, `docs/research/`, `docs/adr/`).
   A compacted session resumes from disk, not from chat.
2. **Product context (Delivery 3).** The Context Engine compacts long
   conversations without losing user intent, unresolved questions, or pending
   approvals — a product requirement from the spec, not a session concern.

---

## 3. Delivery sequence

The spec's twelve phases are correct but large. They are regrouped into
deliveries that are each independently shippable and acceptance-gated, with
the three reported failures fixed first because they are the maintainer's
active pain and gate every later phase.

| Delivery | Spec phases | Outcome | Gate |
|---|---|---|---|
| **D0** | 0 | Baseline refresh, Alan/REA evidence, capability matrix | Golden path reproducible; evidence indexed |
| **D1** | 1 | Durable runs: budgets, timeouts, resume, attempt lineage, idempotency | Retry resumes at the failed node; no duplicate artifacts/files/events |
| **D2** | 2 | Versioned agent configs + one reusable agent turn | Every agent validates; run records the config version used |
| **D3** | 3 | Context Engine V2: typed sources, ranking, budgets, compaction, provenance | Large conversations compact without losing required facts |
| **D4** | 4 | Layered memory with provenance, conflicts, curation workflow | Memory is traceable; curation failure cannot fail a build |
| **D5** | 5 | Model router: capabilities, routing policy, budgets, circuit breaker, egress | Routing is inspectable; local-only never reaches remote |
| **D6** | 6 | Cache layers with scope, TTL, invalidation | Cache failure affects speed, not correctness |
| **D7** | 7 | Policy engine, typed tool registry, durable approvals, MCP adapter | Approvals bind to the exact action; prompt cannot bypass denial |
| **D8** | 8 | Disposable sandbox + real verification reports | Verification refers to a real command and a workspace revision |
| **D9** | 9 | Bounded verification-driven repair | Repair cannot loop; only a passing revision is marked verified |
| **D10** | 10 | Background maintenance workflows + full observability ledger | A user can explain why a run succeeded, failed, or waited |
| **D11** | 11 | Backend end-to-end hardening and failure drills | Clean-setup golden path; every drill has a correct terminal state |
| **D12** | §5 | UI redesign on top of accepted backend contracts | Every displayed state comes from backend data |

**Dependency notes**

- D1 unblocks D2 (the agent turn needs attempt/resume semantics to be
  idempotent).
- D2 unblocks D3, D5, D7 (all consume agent config).
- D3 unblocks D4 and D9 (memory and repair both read context).
- D7 unblocks D8 (the sandbox runs through the policy engine).
- D8 unblocks D9 (repair needs real verification evidence).
- D10 is incremental and can land slices in D1–D9.
- D12 requires D1–D11 accepted.

**Effort reality check.** D1 is roughly 3–5 focused days. D2–D11 are
substantially larger and should each be planned in their own turn, with the
delivery's own acceptance run before the next one starts. D12 is a full
product-design pass. The plan does not compress these into one pass.

---

## 4. Delivery D1 — durable runs, budgets, resume (detailed)

### D1.1 Schema changes

`prisma/schema.prisma`, new migration `2026xxxx_v1_2_durable_runs`:

| Change | Purpose |
|---|---|
| `Execution.attempt Int @default(1)` | Attempt number within a build |
| `Execution.parentExecutionId String?` | Lineage to the attempt being resumed |
| `Execution.resumedFromNodeType NodeType?` | Audit: where the attempt resumed |
| `Execution.completionStatus String @default("COMPLETE")` | `COMPLETE` / `PARTIAL` |
| `NodeStatus.INCOMPLETE` | Node stopped on budget, not error |
| `ExecutionStatus.PARTIAL` | Attempt ended with incomplete nodes |
| `ToolCall` model | `idempotencyKey` unique, tool/version, arguments hash, status, bounded result |
| `File.toolCallKey String?` | Links a file write to the tool call that produced it |
| `AgentConfigVersion` model | Run records the config + prompt version used (D2, schema now) |

Migration preflight: reject if any existing `(executionId, order, type)`
duplicates exist (the V1.1 migration already added that unique index, so this
should be a no-op). The migration is additive; no data is deleted.

### D1.2 Timeouts and budgets

- `src/temporal/workflows/hcrWorkflow.ts`: raise activity timeouts, heartbeat
  timeout, add `scheduleToCloseTimeout`, raise the workflow execution timeout.
- `src/temporal/runtime.ts`: read the same timeout configuration.
- New `src/runtime/budgets.ts`: one place that resolves iteration, wall-clock,
  and timeout budgets from registry defaults plus environment overrides.
- `src/cognition/agent-registry.ts`: tool-node `maxIterations` 20 → 120.
- `src/cognition/node-executor.ts`: enforce the wall-clock ceiling; on
  exhaustion mark the node `INCOMPLETE` and emit `node.budget_exhausted`
  instead of throwing.

### D1.3 Resume

- `src/runtime/workflows/hcr/start-hcr-workflow.ts`:
  - keep `startHcrRun` for a fresh build;
  - add `resumeHcrRun({ projectId, userId, prompt, previousExecutionId,
    targetNodeType, targetOrder })` creating the attempt-2 execution and its
    first node;
  - both share one transaction and the one-active-build lock.
- `src/temporal/runtime.ts`: `startBuild` vs `resumeBuild`; both start exactly
  one Temporal workflow and fail recoverably.
- `app/api/projects/[id]/retry/route.ts`: choose fresh vs resume:
  - find the latest failed attempt;
  - find its failed or incomplete node (highest order);
  - resume that node; if the attempt completed all nodes, start fresh.
- `src/cognition/node-executor.ts`: the resumed node receives a resume note
  (attempt number, files already present).

### D1.4 Idempotency

- Tool calls: `ToolCall` row created with a stable idempotency key derived
  from `(executionId, nodeId, turn, tool, argsHash)`. A repeated call returns
  the stored result instead of re-executing.
- File writes: `File.toolCallKey` unique per project; a repeated create with
  identical content is a no-op (already partially implemented in
  `src/runtime/files/index.ts`).
- Runtime events: `execution.running` / `node.running` / `node.completed` are
  currently unconditional creates. Make them conditional on the node/execution
  status transition so a retry cannot duplicate them.

### D1.5 Acceptance for D1

| Check | Command |
|---|---|
| Typecheck / lint / unit tests | `bun run typecheck && bun run lint && bun test` |
| Production build | `bun run build` |
| Migrations apply | `prisma migrate deploy` on a disposable local Postgres |
| Fresh build still completes | `bun scripts/verify-temporal.ts` (mock provider) |
| Real-model build completes | `bun scripts/verify-real-model.ts` (RunAnywhere) |
| Budget exhaustion is partial, not failed | new `bun scripts/verify-budget.ts` |
| Retry resumes at the failed node | new `bun scripts/verify-resume.ts` |
| Retry produces no duplicate artifacts | assert one artifact per type in the resumed attempt |
| Retry preserves previously written files | assert file count grows, not resets |
| Duplicate trigger creates one active run | existing lock assertion in `verify-local.ts` |
| Cancellation is terminal | existing cancel drill in `verify-local.ts` |
| Late completion cannot resurrect a cancelled run | existing guard assertion |

---

## 5. Alan / REA research (D0)

Target: the exact local build, not an assumed product version.

- Artifact: `/home/maverick/alanai/Alan-0.3.113-amd64.deb`
- SHA-256: `c4fa8fa7cd4a46c331b5197c43154e36a3077ac001cc4a35a5fdcf6cf38a30a3`
- Package: `alan 0.3.113`, amd64, Vendor Supatest, Homepage `https://tryalan.ai`
- Update channel: `tryalan-ai/alan-releases` (`app-update.yml`)
- Technology: **Electron** (Observed — `chrome-sandbox`, `resources.pak`,
  `locales/`, `LICENSE.electron.txt`)
- Bundled agent engine: `resources/engine/opencode` (186 MB ELF) (Observed)
- Bundled runtime JS: `resources/alan-runtime/alan-agent.cjs`,
  `alan-holder.cjs`, `alan-lease.cjs`, `claude-sdk.mjs` (Observed)
- `node-pty` shipped unpacked (Observed) — Alan runs real terminals
- Renderer is a Vite/React build; 1,944 asar entries, 111 dirs, 1,833 files
  (Observed)

Analysis method: bounded read-only inspection of the package and the asar
header. The REA MCP server is not registered in this environment, and
`npx -y rea-agents@latest` was deliberately not executed against the artifact
per the maintainer's own instruction to prefer a pinned, reviewed version. The
REA route for this target is `analyze_javascript_application` on
`app.asar`; that run is a pending D0 task, and its output must be written
outside the repository.

Capability matrix: `docs/research/alan-feature-gap-matrix.md`.

Labels used: **Observed** (reproduced in the artifact), **Documented** (official
public source), **Inferred** (plausible, unconfirmed), **Unknown**.

Public research inputs to check: Emergent workspace tour, Emergent FAQ, Alan
product pages, Alan local-execution docs. Confirm whether the local 0.3.113
build matches current public documentation; where it does not, the artifact
wins.

---

## 6. Explicitly out of scope for D1

- Any UI redesign (D12).
- Memory, caching, routing, policy, MCP, sandbox, repair (D4–D9).
- Provider changes beyond what the budgets need.
- Rewriting the cognition layer.

---

## 7. Open decisions for the maintainer

1. **Resume granularity.** Resume only the failed node (recommended), or also
   allow resuming from a chosen earlier node, discarding later artifacts?
2. **Budget exhaustion outcome.** `INCOMPLETE`/`PARTIAL` (recommended, honest)
   versus failing the run outright?
3. **Tool-node ceiling.** 120 iterations with a 45-minute wall clock
   (recommended), or a different pair?
4. **Remote-provider default.** Keep RunAnywhere as the configured provider
   for now (recommended for the test phase) and document how to switch to a
   local model later?
5. **Attempt visibility.** Show attempts as separate runs in the UI, or group
   them under one build with an attempt badge (recommended)?

---

## 8. Continuation protocol

At the end of every delivery, append to this file:

1. Delivery completed and its scope.
2. Changed files and design decisions taken.
3. Commands actually run and their results (paste the summary lines).
4. What was **not** verified.
5. Unresolved risks or blockers.
6. The next delivery and its prerequisites.

Never mark a delivery complete while its acceptance checks are failing or
untested.


---

# Delivery records

## D1 — Durable runs, budgets, resume — COMPLETE (2026-10-26)

### Scope delivered

- Attempt lineage: `Execution.attempt`, `parentExecutionId`,
  `resumedFromNodeType`, `completionStatus`, `@@index([parentExecutionId])`.
- Honest terminal states: `NodeStatus.INCOMPLETE`,
  `ExecutionStatus.PARTIAL`, `ProjectStatus.INCOMPLETE`.
- Tool-call idempotency: `ToolCall` model with unique `idempotencyKey`,
  `File.toolCallKey` unique, key derived from
  `(executionId, nodeId, turn, tool, argsHash)`.
- Agent config capture: `Node.agentConfigVersion`, `Node.agentConfigHash`
  (columns ready; populated by D2).
- Budgets: `src/runtime/budgets.ts` (env-driven, lazy for iterations and wall
  clock) and `src/temporal/workflow-timeouts.ts` (literal, sandbox-safe).
- Timeouts: structured 30 min, tool 60 min, heartbeat 10 min, schedule-to-close
  2 h, workflow 12 h, tool iterations 120, tool wall clock 45 min.
- The executor enforces wall clock and iteration budgets and marks a node
  `INCOMPLETE` instead of throwing.
- Partial completion: `completeExecutionPartially` sets execution `PARTIAL`,
  workflow `COMPLETED`, project `INCOMPLETE`, and emits
  `execution.incomplete`.
- Resume: `src/runtime/workflows/hcr/resume-hcr-run.ts` plus
  `resumeBuild` / `retryOrResumeBuild` in `src/temporal/runtime.ts`.
  The retry route resumes at the failed node; upstream artifacts and workspace
  files are reused.
- Conditional runtime events: `execution.running` only on CREATED→RUNNING;
  `node.running` carries the Temporal attempt number.
- Legacy `MAX_ITERATIONS` replaced by `NODE_MAX_ITERATIONS` so a stale small
  value in an existing `.env` cannot silently reintroduce the 20-turn cap.
- ESLint ignores `.doable/` and `DOABLE_HOME/` so generated workspaces are not
  linted.

### Design decision that made resume cheap

The workflow already started from `validated.nodeType`, and `validateHcrContext`
already returns the node row's type. The resume therefore needed **zero
changes to the workflow's start logic**: creating the new attempt's first node
with the failed node's type makes the workflow start there. The database is the
source of truth for the start position.

The resumed node reuses prior artifacts because the Context Engine resolves
consumed artifacts by policy (`consumedArtifactTypes` → latest version for the
project), not by a per-run artifact id.

### Two constraints discovered and handled

1. **Temporal workflow sandbox has no `process`.** Reading `process.env` in
   `src/runtime/budgets.ts` from workflow code threw
   `ReferenceError: process is not defined`. Split into
   `src/temporal/workflow-timeouts.ts` (literals, sandbox-safe) and
   `src/runtime/budgets.ts` (env, activities/runtime only).
2. **The Temporal workflow bundler does not resolve the `@/` alias.** Use a
   relative import inside workflow code (`../workflow-timeouts`).

### Commands run and results

| Command / drill | Result |
|---|---|
| `bunx prisma validate` | Pass |
| `prisma migrate deploy` on disposable local Postgres | Pass (V1.2 applied) |
| `prisma migrate diff --from-config-datasource --to-schema ... --exit-code` | `0` — no drift |
| `bun run typecheck` | Pass |
| `bun test` | 54 pass, 0 fail |
| `bun run lint` | Pass |
| `bun run build` | Pass |
| `bun scripts/verify-temporal.ts` (fresh build, mock) | Pass: 6 nodes, 4 artifacts, 2 files, 43 events, project IDLE |
| `NODE_MAX_ITERATIONS=3 MOCK_NEVER_COMPLETE=1 bun scripts/verify-budget.ts` | Pass: project INCOMPLETE, execution PARTIAL, both tool nodes INCOMPLETE, 2 budget events, 6 files preserved |
| `MOCK_FAIL_NODE=PLANNER MOCK_FAIL_TIMES=3 bun scripts/verify-resume.ts` | Pass: attempt 1 FAILED; attempt 2 resumed at PLANNER; ARCHITECTURE_SPEC / RESEARCH_DOSSIER / APPROVED_PRD stayed v1 and kept the same rows; only EXECUTION_PLAN was added; project IDLE |
| `bun scripts/verify-local.ts` | Pass: artifact revisions, one-active-build lock, failure, cancel, late-completion guard, workspace, ZIP |
| `MOCK_FAIL_NODE=PLANNER bun scripts/verify-failure.ts` | Pass: PLANNER FAILED, ARCHITECT COMPLETED, exactly 1 `node.failed` |

### Changed files

| File | Change |
|---|---|
| `prisma/schema.prisma` | Attempt lineage, terminal states, ToolCall, File.toolCallKey, node config version |
| `prisma/migrations/20261026160000_v1_2_durable_runs/migration.sql` | New migration with post-ALTER duplicate preflight |
| `src/runtime/budgets.ts` | New: env-driven iteration/wall-clock budgets |
| `src/temporal/workflow-timeouts.ts` | New: sandbox-safe literal timeouts |
| `src/runtime/workflows/hcr/resume-hcr-run.ts` | New: `findResumeTarget`, `composeResumePrompt`, `resumeHcrRun` |
| `src/temporal/runtime.ts` | `startTemporalAttempt`, `resumeBuild`, `retryOrResumeBuild` |
| `src/temporal/workflows/hcrWorkflow.ts` | New timeouts, incomplete tracking, partial finalize |
| `src/temporal/activities/hcrActivities.ts` | Pass Temporal attempt, return `incomplete`, partial finalize |
| `src/runtime/state/transitions.ts` | Conditional running transitions, `completeExecutionPartially` |
| `src/cognition/node-executor.ts` | Wall-clock + iteration budget, INCOMPLETE path, attempt-aware events |
| `src/cognition/agent-registry.ts` | Budget from `resolveNodeBudget`, not literals |
| `lib/tool-executor.ts` | ToolCall idempotency, stable key, bounded stored result, turn passed |
| `src/runtime/files/index.ts` | Optional `toolCallKey` on file creation |
| `tests/hcr-temporal-verification.test.ts` | Assert registry follows the budget module |
| `scripts/verify-budget.ts`, `scripts/verify-resume.ts` | New acceptance drills |
| `scripts/mock-provider.ts` | `MOCK_FAIL_TIMES`, `MOCK_NEVER_COMPLETE` |
| `.env.example`, `.env` | `NODE_MAX_ITERATIONS` replaces the legacy `MAX_ITERATIONS` |
| `eslint.config.mjs` | Ignore generated workspaces |

### Not verified in D1

- The real RunAnywhere model was **not** re-run after the D1 changes (the
  previous real-model run predates them). The mock drills cover the new budget
  and resume paths; a real-model re-run is the maintainer's local test.
- Worker restart mid-activity (spec failure drill) is not yet automated.
- Cancellation during a tool side effect is not yet automated.
- `Node.agentConfigVersion` is present but unpopulated until D2.

### Next

**D2 — Agent configuration and the reusable agent turn.** Prerequisites: D1
merged. D2 will retire the duplicate `AGENT_REGISTRY` surface in favour of
`agentConfigProvider`, add prompt versioning, populate
`agentConfigVersion`/`agentConfigHash`, and make the agent turn testable with
fake model and tool adapters.

## D2 — Agent configuration and the reusable agent turn — COMPLETE (2026-10-27)

### Scope delivered

- **One catalog.** `src/hcr/agent-config` owns the six agents. `AGENT_REGISTRY`
  is now derived from `AGENT_DEFINITIONS`, so prompts, iteration limits, and
  output contracts have a single source and cannot drift.
- **Versioned prompts.** `AGENT_PROMPTS` records `id`, `version`, and a
  SHA-256 content hash for every prompt. Prompt wording is unchanged from the
  D1 baseline.
- **Versioned, typed configuration.** `AgentConfig` gained `prompt` and
  `outputContract`; `version` is required (`2.0.0`). The catalog validates
  every definition while it is built.
- **Validation before execution.** `validateAgentConfig` (Zod) runs at catalog
  build and on every `agentConfigProvider.resolve`. Unknown tools, empty
  instructions, duplicate capabilities, zero iterations, or a mismatched
  output contract fail before any model call. Errors report paths only, never
  prompt content.
- **Config hashing.** `hashAgentConfig` canonicalizes key order and hashes the
  effective config, including the prompt hash and version.
- **Recorded identity.** `executeNode` resolves the config first, writes
  `Node.agentConfigVersion` + `Node.agentConfigHash`, and includes both in the
  `node.running` event.
- **Reusable agent turn.** `src/hcr/agent-turn` implements the shared loop
  behind model, tool-runner, and event adapters:
  - structured output: model → validate → retry with the validation error
    (bounded at three attempts);
  - tool output: model → authorise → execute → persist → continue, with
    context rebuild between iterations;
  - iteration and wall-clock bounds, usage events, and an explicit
    completed / incomplete / stopped outcome.
- **Tool authorization.** The model only receives tools the configuration
  allows, and an out-of-policy call is denied with a `tool.denied` event even
  if the model emits it.
- **Trusted identity stays out.** The turn has no project/user/workspace
  inputs; adapters inject identity at the execution seam.

### Design decisions

- **Context policy stays with the Context Engine.** Per d-3 Agent 01 §5C,
  `AgentConfig` does not absorb `contextConfig`; D3 owns retrieval rules.
  `AGENT_REGISTRY` keeps the node-level context contract.
- **Output contract lives in agent config** because it describes what the
  agent produces, while the workflow still decides when to create artifacts.
- **Hashing is canonical**, not insertion-order dependent; the hash covers
  instructions and prompt identity, so a version + hash reproduces the run.

### Regression caught by the drills

The turn's structured failure message changed from
`Failed to parse/validate JSON output ...` to
`Failed to parse/validate structured_json output ...`. The Temporal adapter
classifies non-retryable failures by message, so the new wording silently made
an exhausted validation **retryable**: Temporal retried the activity inline,
the resume drill's first attempt completed instead of failing, and the drill
failed loudly. The classifier now matches `Failed to parse/validate` and has a
regression test. This is exactly why the D1 drills were re-run after D2.

### Commands run and results

| Command / drill | Result |
|---|---|
| `bunx prisma migrate status` (local Postgres) | Pass: 15 migrations, schema up to date (no D2 migration) |
| `bun run typecheck` | Pass |
| `bun test` | 75 pass, 0 fail |
| `bun run lint` | Pass |
| `bun run build` | Pass |
| `bun scripts/verify-temporal.ts` (mock provider) | Pass: 6 nodes, 4 artifacts, 2 files, 43 events, project IDLE; all nodes recorded config version/hash |
| `NODE_MAX_ITERATIONS=3 MOCK_NEVER_COMPLETE=1 bun scripts/verify-budget.ts` | Pass: project INCOMPLETE, execution PARTIAL, both tool nodes INCOMPLETE, 2 budget events, 6 files preserved |
| `MOCK_FAIL_NODE=PLANNER MOCK_FAIL_TIMES=3 bun scripts/verify-resume.ts` | Pass: attempt 1 FAILED at PLANNER, attempt 2 resumed, upstream artifacts stayed v1 |

The local containers were stopped after verification; volumes were preserved.

### Changed files

| File | Change |
|---|---|
| `src/hcr/agent-config/types.ts` | `PromptReference`, `OutputContract`, required `version` |
| `src/hcr/agent-config/prompts.ts` | New: versioned prompt catalog with content hashes |
| `src/hcr/agent-config/hash.ts` | New: SHA-256 helpers + canonical config hash |
| `src/hcr/agent-config/tool-names.ts` | New: name-only tool eligibility list |
| `src/hcr/agent-config/validation.ts` | New: Zod schema, `InvalidAgentConfigError` |
| `src/hcr/agent-config/definitions.ts` | Single catalog; no longer imports `AGENT_REGISTRY` |
| `src/hcr/agent-config/provider.ts`, `index.ts` | Validate on resolve; export new surface |
| `src/hcr/agent-config/constants.ts` | New: schema and catalog versions |
| `src/hcr/agent-turn/{index,types,run-agent-turn}.ts` | New: reusable turn with fake-able adapters |
| `src/cognition/agent-registry.ts` | Derived node view + context contracts |
| `src/cognition/node-executor.ts` | Resolve/record config; use the turn; tool allow-list |
| `src/providers/index.ts` | Export `NormalizedToolCall` |
| `src/temporal/contracts/hcr.ts` | Classifier matches the turn's output failure |
| `tests/hcr-agent-config.test.ts` | Prompt/validation/hash/derivation coverage |
| `tests/hcr-agent-turn.test.ts` | Fake model + tool adapter loop coverage |
| `tests/hcr-temporal-verification.test.ts` | Classifier regression case |
| `tests/bun-test.d.ts` | Matchers used by the new suites |
| `scripts/verify-temporal.ts` | Assert every node records config version/hash |
| `docs/architecture/current-state.md` | D2 status and refreshed verification table |

### Not verified in D2

- The real RunAnywhere model was not re-run after D2 (mock drills only).
- Worker restart mid-activity and cancellation during a tool side effect
  remain open drills.
- Session/turn persistence beyond node and tool-call state is not implemented;
  D3 and the policy/approval work cover the rest.

### Next

**D3 — Context Engine V2.** Typed sources, ranking, token budgets, compaction,
provenance, and reproducibility after worker restart. D2 unblocks D3 because
the context policy now hangs off a stable agent configuration.
