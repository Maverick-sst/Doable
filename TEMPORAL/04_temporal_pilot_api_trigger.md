# Agent Task 04 — Temporal Pilot Trigger

## Objective

Add a minimal trigger path for the Temporal pilot without rerouting the production HCR path.

## Scope

Expose a development/test-only or explicitly isolated trigger that starts the pilot Temporal workflow.

The trigger must accept enough identity to correlate the Temporal run with existing Doable records.

## Allowed changes

- One isolated route/server action/command for the pilot.
- Temporal client call.
- Minimal validation.
- Logging/correlation fields.

## Forbidden changes

- Do not replace `startHCRWorkflow()`.
- Do not change HCR event names.
- Do not delete Inngest.
- Do not change Prisma schema.
- Do not alter the user-facing build flow.

## Acceptance criteria

- Pilot can be triggered manually.
- Temporal workflow starts and completes.
- Temporal workflow ID and Doable IDs are visible in logs.
- No production/user flow is rerouted.
- Invalid identity is rejected without creating partial state.

Commit:
`feat(temporal): add isolated pilot trigger`
