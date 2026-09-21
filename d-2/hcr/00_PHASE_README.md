# Doable — HCR → Temporal Migration Phase

## Mission

This phase migrates the durability/orchestration layer of Doable's existing HCR runtime from **Inngest to Temporal**, one controlled slice at a time.

The goal is **not** to rewrite the HCR intelligence.

The goal is:

> Transfer durable workflow execution from Inngest to Temporal while preserving existing Doable product behavior, state transitions, artifacts, events, correlation, and agent cognition.

Temporal becomes the durable orchestration layer. Existing agent implementations remain the cognition/execution layer unless a migration task explicitly requires an adapter.

---

## Non-negotiable engineering rules

1. **Every agent works on its own branch.** Never ask an agent to work directly on `main`.
2. **Strict file ownership.** An agent may modify only files explicitly listed as allowed. Anything else requires stopping and reporting the conflict.
3. **No overlapping implementation scopes for parallel agents.** Parallel work must touch disjoint files/directories.
4. **Do not delete or rewrite Inngest yet.** Inngest is the legacy/rollback/reference implementation until Temporal reaches behavioral parity and the cutover is explicitly approved.
5. **Do not modify Prisma schema in this phase unless a later task explicitly proves a schema change is necessary.**
6. **Do not rewrite agent cognition.** Preserve existing prompts, model calls, context construction, tools, and structured outputs unless the task explicitly concerns an adapter boundary.
7. **Do not change UI/API contracts unnecessarily.** Existing callers should continue to behave as before.
8. **Temporal Workflows must remain deterministic.** External I/O, Prisma, LLM calls, filesystem operations, network calls, and other side effects belong in Activities.
9. **Product state remains in Postgres.** Temporal is the durable orchestration system, not a second product database.
10. **Every change must be independently testable and safely revertible.**
11. **Comments should explain non-obvious production decisions, not narrate obvious code.**
12. **No opportunistic refactors.** If an issue is discovered outside scope, document it and stop rather than expanding the patch.

---

## Current known Temporal foundation

The repository already contains a working Temporal pilot under `src/temporal/`, including:

- Temporal client
- Temporal worker
- workflow exports
- pilot workflow
- pilot activity
- shared Temporal contracts
- pilot API trigger

The pilot proves the Temporal → Activity → Prisma durable state boundary.

Before broadening the migration, reconcile any known configuration mismatch (for example the worker task queue versus the documented `TEMPORAL_TASK_QUEUE`) as a focused cleanup rather than silently carrying ambiguity forward.

---

## Target shape

Current:

```text
POST /chat
   ↓
startHCRWorkflow
   ↓
Inngest
   ↓
workflow coordinator
   ↓
node functions
   ↓
Postgres / artifacts / runtime events
```

Target:

```text
POST /chat
   ↓
Temporal HCR Workflow
   ↓
Temporal Activities
   ↓
existing HCR node implementations
   ↓
Postgres / artifacts / runtime events
```

The migration is incremental. The first Temporal HCR execution should be intentionally small and observable.

---

## Branch / merge protocol

Recommended branch sequence:

```text
main
 │
 ├── phase/hcr-archaeology
 │
 ├── phase/hcr-temporal-contract
 │
 └── phase/hcr-first-node-adapter   (after contract/map merge)
          ↓
      phase/hcr-verification
          ↓
      explicit cutover PR
```

Agents must:

- rebase/merge from the latest approved parent before beginning dependent work;
- run the requested tests before handing off;
- report changed files and test commands;
- never force-push over another agent's branch;
- never merge another agent's branch themselves unless explicitly instructed by the orchestrator.

---

## Merge gates

### Gate 1 — Understanding

`HCR_MIGRATION_MAP.md` accurately describes the existing Inngest HCR behavior.

### Gate 2 — Temporal contract

Temporal workflow/activity contracts are defined without changing production HCR behavior.

### Gate 3 — First node

One real HCR node executes through Temporal while using the existing cognition implementation.

### Gate 4 — Equivalence

Temporal execution is compared with the existing Inngest path for:

- execution status
- node status
- artifacts
- runtime events
- workflow state
- messages
- stable IDs/correlation
- failure behavior
- retries
- duplicate triggers
- worker restart/recovery

### Gate 5 — Cutover

Only after behavioral parity is demonstrated should production triggering move from Inngest to Temporal.

### Gate 6 — Decommission

Inngest orchestration is retired from the production path but retained in the repository as legacy/reference/rollback code until deliberately removed in a later cleanup phase.

---

## Agent dependency graph

```text
Agent 01: Archaeologist
        │
        ├──────────────┐
        ↓              ↓
Agent 02: Contract   [read-only reference]
        │
        └──────┬───────┘
               ↓
Agent 03: First-node adapter
               ↓
Agent 04: Verification
               ↓
Agent 05: Cutover / decommission preparation
```

Agent 01 is read-only and may run in parallel with Agent 02 only if Agent 02 restricts itself to the already-proven Temporal foundation and does not assume undocumented HCR behavior.

Agent 03 must wait for the approved migration map and contract.

Agent 04 must start from the merged implementation, not from a speculative branch.

Agent 05 is intentionally a later gate, not part of the first implementation wave.
