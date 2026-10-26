# Agent 02 — Temporal HCR Contract & Skeleton

## Branch

Create and work only on:

```text
phase/hcr-temporal-contract
```

This branch may run in parallel with Agent 01 because it must not modify the existing HCR/Inngest path.

## Mission

Create the **smallest production-ready Temporal HCR orchestration boundary** needed to begin migration safely.

The objective is to define the durable runtime boundary, not to migrate all HCR nodes.

## Allowed modification scope

Allowed:

```text
src/temporal/**
```

and, if absolutely necessary, a dedicated Temporal test file adjacent to the new implementation.

Do not modify:

```text
app/api/projects/**
app/api/inngest/**
src/runtime/**
prisma/**
UI files
agent prompts/cognition
```

unless the parent repository already has an established Temporal configuration file that must be minimally corrected for the pilot to compile/run. If so, make the smallest isolated change and explicitly report it.

## Required design

Build a Temporal HCR workflow skeleton around the existing stable Doable identity contract.

The workflow should conceptually accept:

```text
workflowId
executionId
projectId
userId
nodeId
optional taskId
```

Use the existing `src/temporal/contracts/types.ts` conventions rather than inventing a second identity model.

## Temporal rules

The Workflow must be deterministic.

The Workflow may:

- orchestrate
- choose the next activity
- carry small serializable state
- enforce workflow-level sequencing
- define retry/timeout policy

The Workflow must NOT directly:

- access Prisma
- call an LLM
- perform filesystem I/O
- call external APIs
- perform arbitrary network operations
- depend on mutable process state

Those operations belong in Activities.

## First skeleton behavior

The skeleton should be able to represent:

```text
HCR execution received
        ↓
validate/resolve execution context through Activity
        ↓
run a single migration-ready node Activity boundary
        ↓
return durable execution result
```

Do not implement every HCR node.

Do not duplicate the existing agent implementation.

## Idempotency

Design the workflow ID around the stable Doable execution identity so that duplicate API triggers do not accidentally create independent product executions.

Do not invent final duplicate-trigger semantics if the existing HCR behavior is not yet mapped. Mark the decision point clearly for Agent 03/04.

## Retry policy

Define explicit Activity timeout/retry settings rather than relying on accidental defaults.

Keep policies conservative and explain non-obvious choices in comments.

## Observability

Return enough stable identifiers to correlate Temporal execution with:

- Doable project
- workflow
- execution
- node

Do not introduce unnecessary schema changes.

If Temporal workflow/run IDs need to be persisted later, expose them cleanly from the contract without forcing a database migration in this task.

## Comments

Use comments for decisions that help a future maintainer understand:

- why an operation is an Activity instead of Workflow code;
- why an ID is deterministic;
- why a retry/timeout policy exists;
- why Postgres remains the product source of truth.

Do not comment every line.

## Hard constraints

- Do not change existing HCR behavior.
- Do not remove Inngest.
- Do not migrate Architect or any other real node yet unless explicitly required merely to compile the skeleton.
- Do not modify Prisma schema.
- Do not introduce a generic agent framework.
- Do not create a second persistence model that mirrors all Postgres state.
- Do not refactor unrelated Temporal pilot code.

## Validation

At minimum:

```bash
bun run typecheck
```

and the existing Temporal pilot verification if available.

If a Temporal worker is required, verify the worker can start and the existing pilot still executes.

## Handoff

Report:

- branch
- exact files changed
- workflow/activity contract
- retry/timeout decisions
- commands run
- whether the existing Temporal pilot remains functional
- any dependency on Agent 01's migration map
