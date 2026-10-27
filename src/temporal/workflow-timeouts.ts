/**
 * Timeouts used inside the Temporal workflow sandbox.
 *
 * Workflow code runs in a deterministic VM where `process` is not defined, so
 * this module must not read environment variables. Keep these values as
 * literals. Operator-tunable budgets that need `process.env` live in
 * `src/runtime/budgets.ts` and are consumed by activities and the runtime
 * boundary, outside the sandbox.
 */

/** Short read-only DB checks. */
export const DATABASE_ACTIVITY_TIMEOUT = "30 seconds" as const;

/** Structured nodes: one model call that may think for a long time. */
export const STRUCTURED_NODE_ACTIVITY_TIMEOUT = "30 minutes" as const;

/** Tool nodes: up to 120 model turns plus file I/O. */
export const TOOL_NODE_ACTIVITY_TIMEOUT = "60 minutes" as const;

/** Heartbeat lease; the heartbeat fires every 30 seconds. */
export const HEARTBEAT_TIMEOUT = "10 minutes" as const;

/** Bound on one activity attempt including scheduled retries. */
export const NODE_SCHEDULE_TO_CLOSE_TIMEOUT = "2 hours" as const;

/** Retry count for node activities. */
export const NODE_ACTIVITY_ATTEMPTS = 3 as const;
/** Memory curation: DB passes plus bounded embedding calls. */
export const MEMORY_ACTIVITY_TIMEOUT = "10 minutes" as const;

/** Sandbox verification: install, build, test, preview, browser probe. */
export const VERIFICATION_ACTIVITY_TIMEOUT = "30 minutes" as const;

/** One repair pass: a bounded tool node plus re-verification scheduling. */
export const REPAIR_ACTIVITY_TIMEOUT = "60 minutes" as const;

/** Total verification plus at most one repair and re-verification. */
export const VERIFICATION_WORKFLOW_TIMEOUT = "3 hours" as const;

export const REPAIR_MAX_ATTEMPTS = 2 as const;
