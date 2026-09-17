# Temporal / Doable Contracts

This document defines the contract between Temporal (durable orchestration) and the Doable application state in Postgres. It exists to keep the two identity/boundary models explicit while the pilot integration is being built.

## Ownership

### Temporal owns: durable orchestration

Temporal workflows are the source of truth for *how* a long-running process unfolds:

- **Sequencing** — ordering of steps, stages, and branches.
- **Waiting** — timers, human-in-the-loop waits, external signal waits.
- **Retries / timeouts** — activity retry policy, schedule-to-close timeouts, heartbeat rules.
- **Branching decisions** — routing based on activity results, state, or external signals.
- **Long-running state progression** — which stage is currently active, what has already completed, and what is next.

Temporal is **not** the source of truth for product entities such as projects, workflows, executions, nodes, artifacts, or messages.

### Postgres owns: product source of truth

The existing Doable schema remains authoritative for:

- `Workflow`, `Execution`, and `Node` status and lifecycle.
- `Artifact` records and versions.
- `RuntimeEvent` history and audit log.
- `Project` state, including `ProjectMemory`.
- `Message` history.
- `File` metadata and content.

Activities perform writes to these tables; workflows decide *when* those writes happen.

## Activity boundaries

Activities are the only place where side effects should occur. A Temporal activity may:

- Write to Postgres (`Workflow`, `Execution`, `Node`, `RuntimeEvent`, `Artifact`, `ProjectMemory`, etc.).
- Call LLMs or other network services.
- Interact with the filesystem or sandbox.
- Invoke external APIs, webhooks, or tool calls.

Workflows should be deterministic and free of side effects. If a side effect is required, it belongs in an Temporal activity.

## Identity correlation

Temporal workflow identity and Doable database identity are not automatically the same. The correlation strategy is explicit mapping, not equality.

| Identity | Owner | Purpose |
| --- | --- | --- |
| `temporalWorkflowId` | Temporal | The Temporal workflow execution identifier; used to start, signal, or query a workflow. |
| Doable `workflow.id` | Postgres | Product-level workflow record. |
| `execution.id` | Postgres | Product-level execution record. |
| `node.id` | Postgres | Product-level node record. |
| Task / activity identity | Temporal | Activity type/name plus the `DoableIdentity` supplied as input. |

Correlation strategy:

1. The caller creates the Doable `Workflow` / `Execution` / `Node` records first (or an activity does).
2. The same stable Doable identifiers are passed into the Temporal workflow as `DoableIdentity`.
3. Temporal uses its own `temporalWorkflowId` for the workflow execution, but every activity receives the `DoableIdentity` so it can update the correct Postgres rows.
4. Correlation helper types live in `src/temporal/contracts/types.ts`.

## Idempotency contract

Activities with side effects must tolerate Temporal replay and retry. The contract is:

- Use stable Doable identifiers as the idempotency key:
  - `workflowId`
  - `executionId`
  - `nodeId`
  - `artifactId`
  - `toolCallId`
- Activities should be written so that executing the same activity twice with the same identity produces the same product state.
- Do not generate new side-effect identifiers inside an activity unless they are derived from a stable input (e.g. deterministic hash or an already-stored ID).
- This task defines the contract only; a concrete idempotency helper will be added later.

## Failure classification

Failures fall into four conceptual categories:

| Category | Description | Example | Conceptual handling |
| --- | --- | --- | --- |
| Retryable activity failure | Transient issue that may succeed on retry. | Network timeout, rate limit, temporary DB lock. | Let Temporal retry with exponential backoff. |
| Non-retryable failure | A deterministic failure that will not succeed by retrying. | Invalid input, missing required record, bad configuration. | Fail the activity immediately; workflow may compensate or terminate. |
| Workflow-level terminal failure | The workflow cannot make progress and must end. | Unrecoverable error, required signal never received, max retries exceeded. | Workflow transitions to a terminal state and records status in Postgres. |
| Unknown external side-effect outcome | Side effect may or may not have completed; outcome is ambiguous. | LLM call timed out after request was sent; webhook delivery unknown. | Record the ambiguity, allow a future run or human review to reconcile. |

This task defines the contract only; concrete recovery policies are implemented in later tasks.
