# Agent 01 — HCR Archaeologist

## Branch

Create and work only on:

```text
phase/hcr-archaeology
```

Never modify `main`.

## Mission

Reverse-engineer the **actual current HCR execution path** from source code and document it precisely enough that another engineer can migrate orchestration without guessing.

This is a **read-only archaeology task**.

## Allowed modifications

Only create/update:

```text
HCR_MIGRATION_MAP.md
```

No production source changes are allowed.

## Source areas to inspect

Trace the complete current path, including at minimum:

- `app/api/projects/[id]/chat/route.ts`
- `app/api/inngest/route.ts`
- `startHCRWorkflow` and its implementation
- HCR workflow/coordinator implementation under the runtime/inngest areas
- the Architect node and the next node(s) actually reachable from the coordinator
- execution/node/workflow/artifact/runtime-event persistence
- relevant Prisma models/types
- `app/api/projects/[id]/hcr/route.ts`
- existing tests around HCR/inngest if present

Do not infer behavior from filenames. Follow calls, data, status transitions, retries, and side effects.

## Document

`HCR_MIGRATION_MAP.md` must contain:

1. Current entry point.
2. Exact execution graph.
3. Every Inngest function involved.
4. Event names and payloads.
5. Workflow/execution/node lifecycle transitions.
6. Database writes and their order.
7. Artifact creation/update behavior.
8. Runtime event behavior.
9. Message behavior.
10. Agent/cognition calls.
11. Retry semantics.
12. Failure paths.
13. Duplicate-trigger/idempotency behavior.
14. Correlation identifiers.
15. What must remain behaviorally identical after migration.
16. Files that a Temporal implementation will likely need to touch.
17. Unknowns or ambiguities that require human approval.

Include a compact sequence diagram using Mermaid or ASCII.

For every important transition, identify:

```text
WHO performs it
WHAT state changes
WHERE it is persisted
WHEN it happens
WHAT happens on failure/retry
```

## Hard constraints

- Do not refactor code.
- Do not rename production symbols.
- Do not fix unrelated bugs.
- Do not change Prisma schema.
- Do not change Inngest behavior.
- Do not design new Temporal abstractions beyond documenting migration requirements.
- Do not claim behavior that source inspection cannot establish.

## Quality bar

Another agent should be able to read `HCR_MIGRATION_MAP.md` and answer:

> “If I replace Inngest with Temporal, what exact behavior must I preserve?”

without reopening the entire codebase.

## Validation

Run only read-only checks appropriate to the repository, such as:

```bash
bun run typecheck
```

if available and safe.

Do not modify generated files or lockfiles merely to make validation pass.

## Handoff

Report:

- branch
- file created
- files inspected
- tests/checks run
- exact unresolved questions
- confirmation that no production source files were modified
