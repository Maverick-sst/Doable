# Agent Task 01 — Temporal Worker Bootstrap

## Objective

Add a minimal Temporal worker/runtime boundary to Doable.

The worker must be able to connect to Temporal and execute a trivial workflow/activity without touching the current HCR or Discovery behavior.

## Context

Doable currently uses Inngest for asynchronous orchestration. The HCR function is the active agent execution path.

We are introducing Temporal incrementally. This task is infrastructure only.

Current important files:
- `app/inngest/functions/hcr-agent.ts`
- `src/runtime/workflows/hcr/start-hcr-workflow.ts`
- `package.json`

## Allowed changes

- Temporal dependency/configuration files.
- New Temporal worker/client/workflow/activity files in a clearly isolated directory.
- Minimal scripts needed to run the Temporal worker locally.
- Environment/config documentation directly related to Temporal.

## Forbidden changes

- Do not modify HCR behavior.
- Do not modify Discovery behavior.
- Do not remove or alter Inngest.
- Do not change Prisma schema.
- Do not change `node-executor.ts`.
- Do not change tool execution.
- Do not change LLM/context behavior.
- Do not introduce migrations or production infrastructure changes.

## Required result

Create:

1. A Temporal client boundary.
2. A Temporal worker entrypoint.
3. One trivial deterministic workflow.
4. One trivial activity with a side-effect-free or clearly local test behavior.
5. A documented local run command.

## Acceptance criteria

- TypeScript build/typecheck succeeds.
- Existing app behavior is unchanged.
- Temporal worker starts successfully against the configured Temporal target.
- Trivial workflow executes successfully.
- Worker restart does not require code changes to rerun the test.
- No existing Doable workflow is routed through Temporal yet.

## Verification

Provide:
- commands executed
- expected/actual result
- files changed
- any environment variable added
- exact branch name used

## Commit

`feat(temporal): bootstrap worker and client boundary`
