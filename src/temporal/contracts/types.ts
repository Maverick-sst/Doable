/**
 * Minimal contract types for the Temporal pilot integration.
 * These types describe identity and input shape; they do not implement
 * the runtime. All identifiers come from the Doable domain so that
 * replay and retry stay deterministic and idempotent.
 */

/** Stable identity assigned by Temporal when a workflow execution starts. */
export type TemporalIdentity = string;

/** Bundle of stable Doable identifiers that correlate a Temporal run to product state. */
export interface DoableIdentity {
  /** Doable workflow.id (Postgres Workflow). */
  workflowId: string;

  /** Doable execution.id (Postgres Execution). */
  executionId: string;

  /** Doable node.id (Postgres Node). */
  nodeId: string;

  /** Doable project.id (Postgres Project). */
  projectId: string;

  /** Optional stable task/activity identifier for fine-grained correlation. */
  taskId?: string;
}

/** Input passed to the Temporal pilot workflow. */
export interface TemporalPilotWorkflowInput {
  /** Caller-supplied identity mapping. */
  identity: DoableIdentity;

  /** Optional Temporal-specific execution settings. Keep small; durable config belongs in Temporal. */
  options?: {
    /** Maximum time the workflow execution may run. */
    executionTimeoutMs?: number;
  };
}

/** Input passed to every Temporal pilot activity. */
export interface TemporalPilotActivityInput<TPayload = unknown> {
  identity: DoableIdentity;

  /** Activity-specific payload. Keep pure data; no functions, no non-serializable state. */
  payload: TPayload;
}

/** Stable correlation key built from a Doable identity and an operation name.
 *  Activities should use this shape (or a deterministic hash of it) as an
 *  idempotency / deduplication key. */
export type DoableOperationKey = string;

/** Helper that produces a stable correlation key for a given operation. */
export type CorrelateOperation = (
  identity: DoableIdentity,
  operationName: string,
) => DoableOperationKey;
