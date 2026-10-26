# HCR Migration Map — Actual Current Behavior (Source-Verified)

Branch: `phase/hcr-archaeology`
Scope: read-only archaeology. No production source changes.
Base inspected: `feat/temporal-pilot-trigger` (contains HCR Inngest path + Temporal pilot).

Files inspected:
- `app/api/projects/[id]/chat/route.ts`
- `app/api/projects/[id]/hcr/route.ts`
- `app/api/inngest/route.ts`
- `app/inngest/client.ts`
- `app/inngest/functions/hcr-agent.ts`
- `app/inngest/functions/workflow-coordinator.ts`
- `app/inngest/functions/nodes/architect-node.ts` (+ researcher/prd-reviewer/staff-engineer/frontend-engineer/backend-engineer — same shape)
- `app/inngest/functions/embedFile.ts`
- `src/runtime/workflows/hcr/start-hcr-workflow.ts`
- `src/runtime/workflows/hcr/transition-map.ts`
- `src/runtime/artifacts/create-artifact.ts`
- `src/cognition/node-executor.ts`
- `src/cognition/agent-registry.ts`
- `src/cognition/context-engine.ts`, `src/cognition/llm.ts`
- `src/shared/types.ts`
- `lib/handleFailure.ts`, `lib/auth-user.ts`, `lib/prisma.ts`, `lib/embeddings.ts`, `lib/tools.ts`, `lib/tool-executor.ts`, `lib/toolCompletion.ts`
- `prisma/schema.prisma`
- `src/temporal/*` (reference only, not part of HCR path)

No `tests/**`, no `*.test.ts` / `*.spec.ts` found. Pilot scripts only: `scripts/run-pilot-workflow.ts`, `scripts/temporal-hello.ts`, `scripts/test-discovery.ts`.

---

## 1. Current entry point

Only production entry is `POST app/api/projects/[id]/chat/route.ts`:

1. `requireDbUser()` (`lib/auth-user.ts`) — Clerk `auth()`, DB lookup by `clerkId`, self-heal upsert. All project queries scoped by `user.id`.
2. `prisma.project.findFirst({ where: { id: projectId, userId: user.id, status: { in: [PENDING, IDLE] } } })` — 404 otherwise. No row lock.
3. Parse JSON, require `prompt: string` (manual check, not Zod).
4. `prisma.message.create({ projectId, role: USER, content: prompt, phase: BUILD })`.
5. `startHCRWorkflow(projectId, user.id, prompt)` — creates Workflow/Execution/Node + events (see §6).
6. `prisma.project.update({ where: { id }, data: { status: IN_PROGRESS } })`.
7. `inngest.send({ name: "node/execute", data: { projectId, userId, workflowId, executionId, nodeId, nodeType: ARCHITECT, prompt: message.content, inputArtifactId: null } })`.
8. Returns `{ projectId, messageId, message, status: "processing" }`. On `inngest.send` throw: 500 `Failed to start workflow worker` — DB records already exist (orphaned `CREATED` chain).

`GET app/api/projects/[id]/hcr/route.ts` is inspection-only: auth + ownership check, then latest `Workflow{type:HCR}` with latest `Execution` including `nodes order:order asc`, `artifacts order:createdAt asc`, `events order:createdAt asc`. Returns empty arrays when none. Never triggers execution.

## 2. Exact execution graph

```
POST /chat {prompt}
  ↓ startHCRWorkflow()
  Workflow(HCR,CREATED) → Execution(CREATED) → Node(ARCHITECT,CREATED,order:1)
  ↓ inngest.send node/execute {ARCHITECT}
architect-node (guard nodeType==ARCHITECT)
  ↓ executeNode(AGENT_REGISTRY[ARCHITECT])
  ARCHITECTURE_SPEC artifact → inngest.send node/completed
  ↓ workflow-coordinator (node/completed)
  HCR_TRANSITION_MAP[ARCHITECTURE_SPEC] → Node(RESEARCH,CREATED,order:2) → node/execute
researcher-node → RESEARCH_DOSSIER → node/completed
  ↓ coordinator → Node(PRD_REVIEWER,CREATED,order:3) → node/execute
prd-reviewer-node → APPROVED_PRD → node/completed
  ↓ coordinator → Node(PLANNER,CREATED,order:4) → node/execute
staff-engineer-node (NodeType.PLANNER) → EXECUTION_PLAN → node/completed
  ↓ coordinator → Node(FRONTEND_ENG,order:5) + Node(BACKEND_ENG,order:5) → 2× node/execute (fan-out)
frontend-engineer-node || backend-engineer-node (parallel, tool_calls, no artifact)
  ↓ each sends node/completed {outputArtifactType:null}
  ↓ coordinator: if count(CREATED|RUNNING)>0 → return (wait); else finalizeWorkflow()
finalizeWorkflow(): Execution(COMPLETED) + Workflow(COMPLETED) + Project(IDLE) + 2 events
```

Transition table (`src/runtime/workflows/hcr/transition-map.ts`):
- `ARCHITECTURE_SPEC → [RESEARCH] order:2`
- `RESEARCH_DOSSIER → [PRD_REVIEWER] order:3`
- `APPROVED_PRD → [PLANNER] order:4`
- `EXECUTION_PLAN → [FRONTEND_ENG, BACKEND_ENG] order:5`
- FE/BE produce `null` → terminal (no map entry → finalize path).

## 3. Every Inngest function involved

Served in `app/api/inngest/route.ts` via `serve({ client, functions: [...] })`, exposes `GET,POST,PUT`:

| Function | File | Trigger | Retries | Role |
|---|---|---|---|---|
| `hcr-agent` | `app/inngest/functions/hcr-agent.ts` | `chat/requested` | 3 | DEAD — nothing sends `chat/requested`; legacy monolithic ARCHITECT loop. Keep as reference, do not migrate. |
| `workflow-coordinator` | `app/inngest/functions/workflow-coordinator.ts` | `node/completed` | 2 | Creates next Node(s) or finalizes. |
| `architect-node` | `app/inngest/functions/nodes/architect-node.ts` | `node/execute` | 3 | Guard `nodeType!==ARCHITECT → return`; `step.run("execute-architect", executeNode(ARCHITECT))`. |
| `researcher-node` | `.../researcher-node.ts` | `node/execute` | 3 | Same shape, guard `RESEARCH`. |
| `prd-reviewer-node` | `.../prd-reviewer-node.ts` | `node/execute` | 3 | Guard `PRD_REVIEWER`. |
| `staff-engineer-node` | `.../staff-engineer-node.ts` | `node/execute` | 3 | Guard `PLANNER` (not STAFF_ENGINEER). |
| `frontend-engineer-node` | `.../frontend-engineer-node.ts` | `node/execute` | 3 | Guard `FRONTEND_ENG`. |
| `backend-engineer-node` | `.../backend-engineer-node.ts` | `node/execute` | 3 | Guard `BACKEND_ENG`. |
| `embedFile` | `app/inngest/functions/embedFile.ts` | `file/embedding-requested` | default | File embedding only, not HCR sequencing. |

Client: `app/inngest/client.ts` — `new Inngest({ id: "Doable" })`, no event schema.

## 4. Event names and payloads

Product-level Inngest events (types in `src/shared/types.ts`):

`node/execute` — fired by chat route (ARCHITECT, `inputArtifactId:null`) and coordinator (next nodes, `inputArtifactId:outputArtifactId`):
```ts
{ projectId, userId, workflowId, executionId, nodeId, nodeType, prompt, inputArtifactId: string|null }
```

`node/completed` — fired by `executeNode()` in both branches:
```ts
{ projectId, userId, workflowId, executionId, nodeType, outputArtifactId: string|null, outputArtifactType: ArtifactType|null, prompt }
```
FE/BE always send `outputArtifactId:null, outputArtifactType:null`.

Legacy / unrelated:
- `chat/requested` — trigger of dead `hcr-agent`, no sender found.
- `file/embedding-requested` — from `lib/tool-executor.ts` `createFile`, consumed by `embedFile`.

## 5. Workflow / execution / node lifecycle transitions

Enums (`prisma/schema.prisma`): `WorkflowStatus{CREATED,QUEUED,RUNNING,PAUSED,COMPLETED,FAILED,CANCELLED}`, `ExecutionStatus{CREATED,RUNNING,COMPLETED,FAILED,CANCELLED}`, `NodeStatus{CREATED,RUNNING,COMPLETED,FAILED,SKIPPED}`, `ProjectStatus{DISCOVERY,PENDING,IN_PROGRESS,IDLE,FAILED}`, `WorkflowType{DISCOVERY,HCR}`, `NodeType{...ARCHITECT,RESEARCH,PRD_REVIEWER,PLANNER,FRONTEND_ENG,BACKEND_ENG...}`, `ArtifactType{DISCOVERY_REQUIREMENT,ARCHITECTURE_SPEC,RESEARCH_DOSSIER,APPROVED_PRD,EXECUTION_PLAN}`.

Observed HCR transitions (no other transitions exist in code):
- `Workflow: CREATED → COMPLETED` (finalize) or `CREATED → FAILED` (handleFailure). Never set to `RUNNING` in HCR path (discovery does).
- `Execution: CREATED → RUNNING` (first line of `executeNode`) `→ COMPLETED` (finalize) or `→ FAILED`.
- `Node: CREATED → RUNNING → COMPLETED` or `→ FAILED`. FE/BE force `COMPLETED` if `mark_complete` tool did not already.
- `Project: PENDING|IDLE → IN_PROGRESS` (chat route) `→ IDLE` (finalize). `handleFailure` does NOT update `Project` — project stays `IN_PROGRESS` on failure (verified gap).

## 6. Database writes and their order

Chat trigger (`app/api/projects/[id]/chat/route.ts` + `start-hcr-workflow.ts`):
1. `message.create` (USER, BUILD).
2. `workflow.create {projectId, type:HCR, status:CREATED}`.
3. `execution.create {workflowId, status:CREATED}`.
4. `node.create {executionId, type:ARCHITECT, status:CREATED, order:1}`.
5. `runtimeEvent.createMany [workflow.created, execution.created, node.created]`.
6. `project.update {status:IN_PROGRESS}`.

Per node (`src/cognition/node-executor.ts:executeNode`):
1. `execution.update {RUNNING}` (plain update, no guard).
2. `node.update {RUNNING}`.
3. `runtimeEvent.createMany [execution.running, node.running]`.
4. Structured path: `getEmbeddings` → `buildNodeContext` → `callLLM` (up to 3 attempts) → idempotency `artifact.findFirst({nodeId})` → `createArtifact` (if miss) → `node.update COMPLETED` → `runtimeEvent node.completed` → `inngest.send node/completed`.
5. Tool path (FE/BE): fetch files + last-10 BUILD messages → loop ≤20: `buildNodeContext` → `callLLM(request, tools)` → per tool `runtimeEvent tool.called` → `executeTool` (+ file writes) → `handleToolCompletion` (`tool.completed` event) → `mark_complete` breaks → force `node COMPLETED` + `node.completed` if needed → `inngest.send node/completed {null,null}`.

Coordinator (`workflow-coordinator.ts:step.run coordinate-next-node`):
- If `outputArtifactType` has map entry: per `nextNodes`: `node.create {CREATED, order}` → `runtimeEvent node.created` → `inngest.send node/execute {inputArtifactId:outputArtifactId}`.
- If no entry and `outputArtifactType===null`: `node.count({executionId, status in [CREATED,RUNNING]})`; if >0 return (wait for parallel peer); else `finalizeWorkflow`.
- `finalizeWorkflow`: `execution.update COMPLETED` → `workflow.update COMPLETED` → `project.update IDLE` → `runtimeEvent.createMany [execution.completed, workflow.completed]`.

Failure (`lib/handleFailure.ts` via `onFailure`): `workflow.update FAILED` → `execution.update FAILED` → `node.update FAILED` → `runtimeEvent.createMany [workflow.failed, execution.failed, node.failed]`.

## 7. Artifact creation / update behavior

- Only via `createArtifact()` (`src/runtime/artifacts/create-artifact.ts`). Never updated.
- Version: `findFirst({projectId, workflowId, type} order version desc)` → `+1` else `1`.
- Stores `{projectId, workflowId, executionId?, nodeId?, type, version, producedBy, content(Json), metadata?}` + parent/child version links exist in schema but unused in HCR path.
- Emits `artifact.created {artifactId, artifactType, version, workflowId}` when `executionId` present.
- Idempotency: `node-executor.ts:126` checks `artifact.findFirst({nodeId})` before create; reuses existing id on retry. No unique DB constraint on `nodeId` — race relies on Inngest single-delivery.
- Consumed-input resolution: explicit `inputArtifactId` if provided, else `findFirst({projectId, type: consumedArtifactTypes[0]} order version desc)`. ARCHITECT consumes latest `DISCOVERY_REQUIREMENT` when `inputArtifactId` is null.
- FE/BE produce no artifact; `File` rows are the downstream effect.

## 8. Runtime event behavior

Append-only audit log (`RuntimeEvent{executionId, nodeId?, type:string, payload:Json?}`). Observed types:
`workflow.created/running(not in HCR)/completed/failed`, `execution.created/running/completed/failed`, `node.created/running/completed/failed`, `artifact.created`, `tool.called`, `tool.completed`.

- Created via `create` or `createMany`; never updated/deleted in HCR path.
- Every transition in §6 emits ≥1 event. `artifact.created` emitted inside `createArtifact`.
- Payloads carry stable IDs (`workflowId`, `executionId`, `nodeId`, `artifactId`, `nodeType`) plus `taskId/source` only in pilot activity (not HCR).
- Ordering for reads: HCR inspection route orders events by `createdAt asc`.

## 9. Message behavior

- Chat route creates one `Message{role:USER, phase:BUILD, content:prompt}` per trigger.
- No `ASSISTANT` message writes in HCR path (verified: `node-executor` never touches `Message`).
- FE/BE context reads `message.findMany({projectId, phase:BUILD} order createdAt desc take 10)` then reverses. Structured nodes pass `messages:[]`.
- Discovery phase uses `MessagePhase.DISCOVERY` separately; HCR never reads it.

## 10. Agent / cognition calls

Registry (`src/cognition/agent-registry.ts`):

| Node | Consumes | Produces | Mode | Tools |
|---|---|---|---|---|
| ARCHITECT | DISCOVERY_REQUIREMENT | ARCHITECTURE_SPEC | structured_json | none, maxIter 1 |
| RESEARCH | ARCHITECTURE_SPEC | RESEARCH_DOSSIER | structured_json | none, maxIter 1 |
| PRD_REVIEWER | RESEARCH_DOSSIER | APPROVED_PRD | structured_json | none, maxIter 1 |
| PLANNER (staff-engineer-node) | APPROVED_PRD | EXECUTION_PLAN | structured_json | none, maxIter 1 |
| FRONTEND_ENG | EXECUTION_PLAN | null (files) | tool_calls | full file tools, maxIter 20 |
| BACKEND_ENG | EXECUTION_PLAN | null (files) | tool_calls | full file tools, maxIter 20 |

- `buildNodeContext` (`src/cognition/context-engine.ts`): latest consumed artifacts as `=== PROJECT <TYPE> (vN) === JSON`; optional file tree, pgvector `embedding <=> promptEmbedding LIMIT 5` (truncated 700 chars), history, scratchpad last-8. Final `LLMMessage[] = [system, user(consumed+CURRENT TASK+tree+relevant+scratchpad), ...history, ...toolMessages, user(prompt)]`.
- `callLLM` (`src/cognition/llm.ts`): OpenRouter POST with `OPENROUTER_API_KEY`, `MODEL`, `tools?tool_choice:auto`.
- `getEmbeddings` (`lib/embeddings.ts`): OpenRouter `nvidia/llama-nemotron-embed-vl-1b-v2:free`, 768 dims.
- Structured validation: `cleanAndParseJSON` regex `\{[\s\S]*\}` + `validateArtifact(type, content)` (Zod schemas in `src/cognition/types/artifact-validators.ts`).
- Tools (`lib/tools.ts`, `lib/tool-executor.ts`): `create_file/edit_file/read_file/delete_file/mark_complete`, all scoped by `projectId` + ownership check. `createFile` fires `file/embedding-requested`.

## 11. Retry semantics

- Inngest function retries: 6 node functions `retries:3`, coordinator `retries:2`, dead `hcr-agent` `retries:3`. No backoff/timeout config — SDK defaults.
- `step.run` wraps `executeNode` and `coordinate-next-node`; Inngest replays `step.run` on failure.
- In-code LLM retry: structured nodes retry up to 3× on JSON parse/validate failure with corrective `user: previous response invalid... return ONLY JSON`. Tool-call loop has no per-call LLM retry; loop continues to `maxIterations`.
- Node status updates are plain `update` (not conditional `updateMany`), so Inngest retry re-runs full `executeNode` from `RUNNING` marking; artifact dedup is the only guard.

## 12. Failure paths

- Any throw inside `executeNode` (LLM fail after 3 tries, DB error, embedding error) bubbles to Inngest → retries per function config → after exhaustion `onFailure({event})` → `handleFailure(executionId, nodeId, workflowId)` → `FAILED` on all three + 3 events. Project left `IN_PROGRESS`.
- `onFailure` destructures `event.data.event.data`; if shape mismatches it throws (no guard).
- Coordinator failures: same `retries:2` but no `onFailure` configured — failure leaves execution mid-graph with no `FAILED` marking.
- Chat-route `inngest.send` failure: 500 after `CREATED` records + `IN_PROGRESS` already persisted; no rollback.
- `hcr-agent` dead path failure semantics irrelevant (never triggered).
- Terminal vs transient not distinguished in code — all exceptions retry equally.

## 13. Duplicate-trigger / idempotency behavior

- No dedup on trigger: each `POST /chat` (when project is `PENDING|IDLE`) creates a new `Workflow+Execution+Node` chain even for identical prompt. Two rapid POSTs can both pass the status check before either sets `IN_PROGRESS` (race, no transaction/lock).
- Inngest events carry no idempotency key; `node/execute` re-delivery would re-run `executeNode` for same `nodeId`.
- Existing guards: artifact reuse by `nodeId` (structured path only); coordinator parallel guard `count(CREATED|RUNNING)>0 → wait`; pilot activity uses conditional `updateMany(where:{status})` (HCR `executeNode` does not).
- Consequence: Temporal retry of same `nodeId` is safe for structured nodes (artifact reuse) but `runtimeEvents` (`running/completed`) would duplicate because they are unconditional creates. FE/BE file tools have no idempotency key — retry could duplicate `create_file` (relies on `validateProjectAccess` + path uniqueness, not stable call IDs).

## 14. Correlation identifiers

Every hop carries: `projectId, userId (DB user.id, not clerkId), workflowId, executionId, nodeId, nodeType, prompt`, plus `inputArtifactId` (execute) or `outputArtifactId/outputArtifactType` (completed). `prompt` is threaded unchanged from chat message through every coordinator hop. `DoableIdentity{workflowId,executionId,nodeId,projectId,userId,taskId?}` (Temporal contracts) maps 1:1 to these fields; Temporal `temporalWorkflowId` is separate (`pilot-<executionId>` in pilot route).

## 15. What must remain behaviorally identical after migration

- Entry gating: only `PENDING|IDLE` projects start; `USER/BUILD` message created; `ARCHITECT order:1` first node.
- Lifecycle values and order: `CREATED→RUNNING→COMPLETED` (or `FAILED`), `Project IN_PROGRESS→IDLE` on success, event types/payload shapes, artifact versioning (never update), `artifact.created` emission.
- Graph and fan-out: exact `HCR_TRANSITION_MAP` order numbers, parallel FE/BE with wait-for-peer guard, `inputArtifactId` chaining.
- Cognition untouched: same prompts, `AGENT_REGISTRY`, context assembly, validators, `maxIterations`, tool set.
- Failure: `FAILED` on workflow/execution/node + 3 events via same conditions; no silent forks on duplicate trigger; stable ID correlation.
- Read API: `GET hcr/route.ts` shape unchanged.

## 16. Files a Temporal implementation will likely need to touch

- `src/temporal/workflows/*` (new HCR workflow), `src/temporal/activities/*` (validate-context + node-execution activities), `src/temporal/contracts/types.ts` (extend `DoableIdentity` usage), `src/temporal/worker.ts` (task-queue cleanup: currently hardcoded `greet-task-queue` vs documented `pilot-queue`/`TEMPORAL_TASK_QUEUE`), `src/temporal/client.ts` (reuse).
- Adapter boundary only: import `executeNode` + `AGENT_REGISTRY` (no copy). Do NOT touch `app/api/projects/**`, `app/api/inngest/**`, `src/runtime/**`, `prisma/**`, prompts, UI in contract phase.
- Later (not this phase): trigger route (`chat/route.ts`) for cutover, verification docs/tests.

## 17. Unknowns / ambiguities requiring human approval

1. `hcr-agent.ts (chat/requested)` is dead — confirm ignore vs delete (phase says retain Inngest as reference; propose ignore).
2. `handleFailure` never resets `Project` from `IN_PROGRESS` — is `IN_PROGRESS`-stuck the intended FAILED state? Affects Temporal terminal-state design.
3. Chat-route race: two concurrent POSTs both pass `PENDING|IDLE` check — should Temporal workflowId (`hcr-<executionId>` vs `pilot-<executionId>`) enforce dedup, or preserve current fork behavior?
4. `executeNode` uses unconditional `update`; should Temporal adapter add conditional `updateMany` (like pilot activity) or preserve duplicate-event behavior for parity?
5. FE/BE file-tool idempotency has no stable `toolCallId` dedup — need decision before giving Temporal retries to tool path.
6. `staff-engineer-node` maps to `NodeType.PLANNER` (naming mismatch) — confirm canonical name for contracts.
7. `MAX_ITERATIONS` env overrides only dead `hcr-agent` (12); live FE/BE use `nodeConfig.maxIterations (20)` — confirm no env override needed.
8. No HCR tests exist — Agent 04 must define equivalence harness from scratch; confirm `typecheck-only` validation is sufficient for Agents 01/02 handoff (no Docker per user instruction).

---

## Sequence diagram (ASCII)

```text
Client → POST /chat → chat/route.ts
  ├─ message.create (USER/BUILD)
  ├─ workflow.create(HCR/CREATED) → execution.create(CREATED) → node.create(ARCHITECT/CREATED,1)
  ├─ events: workflow.created, execution.created, node.created
  ├─ project.update(IN_PROGRESS)
  └─ inngest.send node/execute{ARCHITECT,input:null}
        ↓
architect-node [retries:3] → executeNode()
  ├─ execution→RUNNING, node→RUNNING + 2 events
  ├─ resolve DISCOVERY_REQUIREMENT (latest) → embeddings → buildNodeContext → callLLM ×3 → validate
  ├─ artifact.create ARCHITECTURE_SPEC(vN) + artifact.created (or reuse by nodeId)
  ├─ node→COMPLETED + node.completed
  └─ inngest.send node/completed{ARCHITECTURE_SPEC}
        ↓
coordinator [retries:2] → node.create(RESEARCH,2) + node.created → inngest.send node/execute{RESEARCH,input:archId}
  → … same for PRD_REVIEWER(3) → PLANNER(4) → [FRONTEND_ENG(5)+BACKEND_ENG(5)] parallel
        ↓
FE/BE tool loop (≤20): tool.called → executeTool → tool.completed … → node→COMPLETED → node/completed{null}
  → coordinator counts CREATED|RUNNING; if 0 → finalize: execution→COMPLETED, workflow→COMPLETED, project→IDLE + 2 events
  → on any function exhaustion: handleFailure → workflow/execution/node→FAILED + 3 events (project stays IN_PROGRESS)
```
