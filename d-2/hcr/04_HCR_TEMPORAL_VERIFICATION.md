# Agent 04 — HCR Temporal Verification & Equivalence

## Branch

Create and work only on:

```text
phase/hcr-verification
```

Start from the latest merged implementation of Agent 03.

## Mission

Verify that the first Temporal-backed HCR slice is **behaviorally equivalent enough to the existing Inngest implementation** to justify the next migration step.

This is a verification task first, not a refactoring task.

## Allowed modification scope

Primary scope:

```text
tests/**
src/temporal/** (only when adding narrowly scoped testability hooks)
```

You may add a verification document:

```text
HCR_TEMPORAL_VERIFICATION.md
```

Do not change production HCR/Inngest behavior.

Do not modify Prisma schema.

## Comparison model

Compare the existing Inngest path and Temporal path at the **Doable product boundary**, not merely at the Temporal API boundary.

Verify:

| Dimension | Expected |
|---|---|
| Project association | Same project |
| Workflow identity | Same logical workflow |
| Execution identity | Same logical execution |
| Node identity | Same logical node |
| Execution state | Equivalent lifecycle |
| Node state | Equivalent lifecycle |
| Artifacts | Same expected artifacts/schema |
| Runtime events | Equivalent semantic events |
| Messages | Equivalent user-visible state |
| Correlation | Stable and traceable |
| Failure | No silent corruption |
| Retry | No duplicate side effects |

## Required scenarios

### 1. Happy path

Run one representative HCR execution through the Temporal path.

### 2. Duplicate trigger

Attempt to start the same logical execution twice and verify that the product state does not fork into duplicate executions unexpectedly.

### 3. Activity retry

Induce a controlled transient failure where safe and verify that retry does not duplicate durable side effects.

### 4. Terminal failure

Induce a controlled non-retryable/terminal failure and verify that state remains inspectable and consistent.

### 5. Worker restart

Stop/restart the Temporal worker during an execution where practical and verify that the durable workflow resumes according to the configured semantics.

### 6. Existing pilot regression

Confirm the existing Temporal pilot still functions.

### 7. Inngest reference path

Use the current Inngest implementation as the behavioral reference. Do not alter it merely to make comparison easier.

## Observability

Capture enough evidence to correlate:

```text
Temporal workflow ID
Temporal run ID
Doable workflow ID
Doable execution ID
Doable node ID
runtime event IDs/types where available
artifact IDs where available
```

Do not leak secrets, tokens, prompts containing sensitive user data, or credentials into test logs.

## Failure classification

Every failed verification must be classified as one of:

- implementation bug
- test harness issue
- pre-existing behavior
- intentional Temporal semantic difference
- unresolved design decision

Do not silently “fix” mismatches.

## Hard constraints

- No production refactor.
- No Inngest deletion.
- No schema changes.
- No UI changes.
- No unrelated test cleanup.
- Do not declare parity based only on compilation.

## Deliverable

Create `HCR_TEMPORAL_VERIFICATION.md` containing:

1. Environment/commit tested.
2. Scenarios executed.
3. Expected behavior.
4. Observed behavior.
5. Evidence/IDs.
6. Mismatches.
7. Severity.
8. Required fixes before the next migration.
9. Explicit recommendation: **pass gate / fail gate** based on evidence, without hiding unresolved issues.

## Handoff

Report:

- branch
- tests/scenarios run
- pass/fail for each scenario
- exact mismatches
- exact files changed
- whether the Temporal slice is safe to use as the foundation for migrating the next HCR node
