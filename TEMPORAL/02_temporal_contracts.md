# Agent Task 02 — Temporal Contracts

## Objective

Define the initial Doable/Temporal contracts without migrating behavior.

This task is architecture/contracts only.

## Current model

Postgres already models:

`Project → Workflow → Execution → Node → RuntimeEvent`

with Artifacts attached at workflow/execution/node levels.

The current HCR starter creates these records before agent execution.

## Decisions to encode

### Temporal Workflow

Owns durable orchestration:
- sequencing
- waiting
- retries/timeouts
- branching decisions
- long-running state progression

### Activities

Own side effects:
- database writes
- LLM/network calls
- filesystem/sandbox operations
- external service calls
- artifact persistence when not safely done as workflow logic

### Existing application state

Postgres remains the product source of truth for:
- Workflow/Execution/Node status
- Artifacts
- RuntimeEvent history
- Project state
- Messages
- Files
- ProjectMemory

Do not introduce duplicate authoritative state without a concrete reason.

## Important distinction

Temporal workflow identity and Doable database Workflow identity are not automatically the same thing.

Define a small mapping contract explicitly instead of assuming equality.

At minimum document:
- `temporalWorkflowId`
- Doable `workflow.id`
- `execution.id`
- `node.id`
- task/activity identity
- correlation strategy

## Retry/idempotency contract

Document that any activity with side effects must tolerate replay/retry.

Use stable Doable identifiers where appropriate:
- workflowId
- executionId
- nodeId
- artifactId
- toolCallId

Do NOT invent a universal idempotency implementation yet.

## Failure contract

Classify:
- retryable activity failure
- non-retryable failure
- workflow-level terminal failure
- unknown external side-effect outcome

Define only the contract, not the final recovery implementation.

## Allowed changes

- New contract/type files.
- Temporal architecture documentation.
- Unit tests for pure contract helpers if useful.

## Forbidden changes

- No HCR migration.
- No Inngest removal.
- No Prisma schema changes.
- No API behavior changes.
- No changes to agent loop logic.

## Acceptance criteria

A reviewer can answer:
1. What Temporal owns.
2. What Postgres owns.
3. What an Activity is allowed to do.
4. How identities correlate.
5. What must be idempotent.
6. What happens conceptually on retry/failure.

Commit:
`docs(temporal): define workflow activity and durability contracts`
