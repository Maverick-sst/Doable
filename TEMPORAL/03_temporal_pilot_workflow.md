# Agent Task 03 — Temporal Pilot Workflow

## Objective

Create the first real Doable-shaped Temporal workflow using existing Postgres entities, while keeping the current HCR path untouched.

This is the first integration point.

## Dependencies

Requires Task 01 and Task 02.

## Scope

Build a pilot workflow that represents:

1. receive a project/workflow/execution identity
2. perform one safe activity
3. persist a clearly identifiable result
4. return a deterministic workflow result

The pilot may create or update a dedicated test record/event, but must not execute the existing HCR agent loop.

## Recommended pilot responsibility

Use the existing Workflow/Execution/RuntimeEvent model as the observation surface.

The pilot should prove:
- Temporal starts
- Activity runs
- Postgres can be updated from an Activity
- workflow completes
- repeated execution does not create accidental duplicate durable records when the same logical operation is retried

## Allowed changes

- Temporal pilot workflow/activity files.
- Small reusable persistence helper if required.
- Tests.
- Minimal registration in the worker.

## Forbidden changes

- Do not modify `hcr-agent.ts`.
- Do not replace Inngest.
- Do not migrate `node-executor.ts`.
- Do not modify context/LLM/tool execution.
- Do not change Prisma schema.
- Do not change existing API semantics.

## Acceptance criteria

- A pilot workflow can be started with a known Doable `workflowId` / `executionId`.
- Activity performs the allowed DB operation.
- Temporal workflow completes.
- Result can be correlated back to the Doable execution.
- Worker restart during the run does not lose the workflow.
- Existing HCR E2E test still behaves exactly as before.

Commit:
`feat(temporal): add first durable Doable pilot workflow`
