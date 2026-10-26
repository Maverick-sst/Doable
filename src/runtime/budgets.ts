/**
 * Budget and timeout resolution.
 *
 * One module owns every ceiling the runtime can hit, so an operator can
 * change the shape of a long build without hunting through the workflow and
 * the executor. Values are read once at import time.
 *
 * Temporal note: workflow code must stay deterministic, so these are module
 * constants. A worker restarted with different environment values will use the
 * new values for new runs; already-running histories keep the values they
 * started with.
 */

import type { Duration } from "@temporalio/common";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Structured nodes: one model call, but it may think for a long time. */
export const STRUCTURED_NODE_ITERATIONS = 1;

/**
 * Tool nodes: one model turn per iteration, roughly one file per turn.
 *
 * The env var is deliberately named NODE_MAX_ITERATIONS and not the legacy
 * MAX_ITERATIONS, which belonged to the retired monolithic agent loop and
 * still holds a stale small value in existing environments.
 */
export const DEFAULT_TOOL_NODE_ITERATIONS = 120;

/** Wall-clock ceiling for a tool node, independent of iteration count. */
export const DEFAULT_TOOL_NODE_WALL_CLOCK_MS = 45 * 60 * 1000;

/** Wall-clock ceiling for a structured node. */
export const DEFAULT_STRUCTURED_NODE_WALL_CLOCK_MS = 25 * 60 * 1000;

/** Activity timeouts. These must exceed the wall-clock budget. */
export const STRUCTURED_NODE_ACTIVITY_TIMEOUT: Duration = `${intFromEnv(
  "NODE_ACTIVITY_TIMEOUT_MINUTES",
  30,
)} minutes`;

export const TOOL_NODE_ACTIVITY_TIMEOUT: Duration = `${intFromEnv(
  "TOOL_ACTIVITY_TIMEOUT_MINUTES",
  60,
)} minutes`;

/** Heartbeat lease. The heartbeat fires every 30s, so allow generous slack. */
export const HEARTBEAT_TIMEOUT: Duration = `${intFromEnv(
  "TEMPORAL_HEARTBEAT_TIMEOUT_MINUTES",
  10,
)} minutes`;

export const HEARTBEAT_INTERVAL_MS = intFromEnv(
  "TEMPORAL_HEARTBEAT_INTERVAL_MS",
  30_000,
);

/** Total workflow ceiling. A backstop; per-node budgets bind first. */
export const HCR_WORKFLOW_TIMEOUT: Duration = `${intFromEnv(
  "HCR_WORKFLOW_TIMEOUT_HOURS",
  12,
)} hours`;

/** Bounded total time for one activity attempt including retries. */
export const NODE_SCHEDULE_TO_CLOSE_TIMEOUT: Duration = `${intFromEnv(
  "NODE_SCHEDULE_TO_CLOSE_TIMEOUT_MINUTES",
  120,
)} minutes`;

/** Short DB-only activities. */
export const DATABASE_ACTIVITY_TIMEOUT = "30 seconds";

/** Compensation must not retry; it is idempotent on its own. */
export const COMPENSATION_ATTEMPTS = 1;

export const NODE_ACTIVITY_ATTEMPTS = intFromEnv("NODE_ACTIVITY_ATTEMPTS", 3);

export type NodeBudget = {
  maxIterations: number;
  wallClockMs: number;
};

/**
 * Resolve the budget for one node.
 *
 * Read at call time rather than import time so the ceiling is testable and
 * can be corrected without restarting the worker. Only the executor and
 * activities call this; Temporal workflow durations stay module constants so
 * workflow replay stays deterministic.
 */
export function resolveNodeBudget(
  outputMode: "structured_json" | "tool_calls",
): NodeBudget {
  if (outputMode === "tool_calls") {
    return {
      maxIterations: intFromEnv(
        "NODE_MAX_ITERATIONS",
        DEFAULT_TOOL_NODE_ITERATIONS,
      ),
      wallClockMs: intFromEnv(
        "NODE_WALL_CLOCK_BUDGET_MS",
        DEFAULT_TOOL_NODE_WALL_CLOCK_MS,
      ),
    };
  }

  return {
    maxIterations: STRUCTURED_NODE_ITERATIONS,
    wallClockMs: intFromEnv(
      "NODE_WALL_CLOCK_BUDGET_MS",
      DEFAULT_STRUCTURED_NODE_WALL_CLOCK_MS,
    ),
  };
}
