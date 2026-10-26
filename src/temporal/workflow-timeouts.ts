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