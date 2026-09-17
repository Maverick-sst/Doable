# Doable Day 3 — Temporal Migration Agent Tasks

## Goal

Introduce Temporal as the durable orchestration layer without breaking the current Doable runtime.

Current runtime:
`API/UI → start workflow DB records → Inngest → HCR agent loop → context/LLM/tools → DB/artifacts/events`

Target:
`API/UI → Temporal Workflow → Activities → existing cognition/execution code`

## Non-negotiable rules

- Do NOT delete or disable Inngest.
- Do NOT migrate the HCR loop yet.
- Do NOT change Prisma models in this task batch unless a task explicitly allows it.
- Preserve the current end-to-end flow.
- Every agent works on its own branch.
- Do not share or mutate production-like data.
- Each task must leave the existing application buildable and testable.
- Do not silently refactor unrelated code.

## Task order

1. `01_temporal_worker_bootstrap.md`
2. `02_temporal_contracts.md`
3. `03_temporal_pilot_workflow.md`
4. `04_temporal_pilot_api_trigger.md`

Tasks 1 and 2 may be developed independently.
Task 3 depends on both.
Task 4 depends on task 3.

## Current database relationship

Project
→ Workflow
→ Execution
→ Node
→ RuntimeEvent

Workflow also owns Artifacts; Execution and Node may reference Artifacts.

The current HCR starter creates Workflow/Execution/Node records and initial runtime events in Postgres.

Temporal should become the durable orchestration layer; these Postgres records remain the product-level execution model and observability state.

## Important current-code facts

- `startHCRWorkflow()` creates Workflow, Execution and first ARCHITECT Node records.
- `hcrAgentFunction` is the current Inngest execution path.
- `node-executor.ts` contains reusable cognition/execution logic but currently mixes orchestration, DB state changes, Inngest emission, LLM calls, context assembly and tool execution.
- HCR transitions are currently represented by `HCR_TRANSITION_MAP`.
- Discovery currently has its own synchronous DB-backed workflow helpers.
- The current Prisma schema already has Workflow/Execution/Node/RuntimeEvent/Artifact relations.

References:
- `src/runtime/workflows/hcr/start-hcr-workflow.ts`
- `src/runtime/workflows/hcr/transition-map.ts`
- `app/inngest/functions/hcr-agent.ts`
- `src/cognition/node-executor.ts`
- attached `schema.prisma`
