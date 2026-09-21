# Agent 03 — First Real HCR Node Adapter

## Branch

Create and work only on:

```text
phase/hcr-first-node-adapter
```

Start this branch from the latest merged versions of:

- the approved HCR migration map
- the approved Temporal HCR contract/skeleton

Do not build from stale assumptions.

## Mission

Move **one real HCR execution node** behind the Temporal Activity boundary while preserving the existing node's cognition and product side effects.

The likely first node is `ARCHITECT`, because the current chat entry path emits an Architect node execution. **Verify this against the approved migration map before implementing.**

## Allowed modification scope

Primary ownership:

```text
src/temporal/**
```

and the smallest possible adapter/import boundary needed to invoke the existing node implementation.

Do NOT rewrite the existing node implementation unless the migration map proves an adapter is impossible without a tiny mechanical change.

Do not modify:

```text
prisma/**
UI
chat API behavior
unrelated agents
unrelated Inngest functions
memory systems
model router
```

## Core principle

> Migrate orchestration, not intelligence.

The existing node should continue to perform its existing reasoning/model/tool work.

Temporal should own:

- durable sequencing
- Activity execution
- timeout
- retry
- recovery
- correlation

The existing node remains responsible for cognition.

## Required behavior

Implement one complete vertical slice:

```text
Temporal HCR Workflow
        ↓
First HCR Node Activity
        ↓
Existing node implementation
        ↓
Existing persistence/artifact/event behavior
        ↓
Temporal workflow resumes with result
```

Do not migrate the entire graph in this task.

## State preservation

Preserve existing semantics for:

- execution status
- node status
- workflow status
- artifacts
- runtime events
- messages
- stable IDs
- failure states

Do not create duplicate records merely because Temporal exists.

## Error handling

The adapter must distinguish between:

1. expected business/domain failures;
2. transient failures appropriate for Temporal retry;
3. terminal failures that should surface to the workflow.

Do not blindly retry every exception.

If the existing implementation is not yet explicit enough to distinguish them, document the limitation rather than inventing a broad retry policy.

## Idempotency

The Activity must be safe against Temporal retries.

Use the existing database conditional-update/idempotency patterns where available.

Do not solve idempotency by adding arbitrary database columns in this task.

## Comments

Comments should explain:

- why the existing node is wrapped rather than rewritten;
- why a particular operation is an Activity;
- how retry safety is preserved;
- how Doable execution identity maps to Temporal execution identity.

## Hard constraints

- No new agent cognition.
- No prompt rewrites.
- No model-provider changes.
- No Prisma schema migration.
- No UI changes.
- No deletion of Inngest code.
- No migration of the next node.
- No broad refactor.

## Validation

Prove at least:

### Happy path

A real HCR execution can enter Temporal and complete the migrated node.

### Retry safety

A retried Activity does not create duplicate product state.

### Failure

A controlled failure reaches a known terminal/retry state without corrupting the execution record.

### Existing pilot

The original Temporal pilot still works.

## Handoff

Report:

- migrated node
- exact files changed
- existing implementation reused
- Activity retry/timeout policy
- idempotency mechanism
- test commands
- runtime verification evidence
- known limitations
