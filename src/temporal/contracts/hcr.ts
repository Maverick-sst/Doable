import type { DoableIdentity } from "./types";

/**
 * HCR orchestration boundary contract.
 *
 * Reuses the stable Doable identity model from `./types` so the pilot and
 * HCR paths correlate the same way. Temporal owns sequencing/retries;
 * Postgres remains the product source of truth.
 */

/** Input to the Temporal HCR workflow (first-node slice: ARCHITECT). */
export interface TemporalHcrWorkflowInput {
  identity: DoableIdentity;
  /** Original user prompt, threaded unchanged like the Inngest path. */
  prompt: string;
  /** Explicit input artifact; null for the first node (resolves latest DISCOVERY_REQUIREMENT). */
  inputArtifactId?: string | null;
}

/** Input to every HCR activity. Payload stays empty until Agent 03 defines it. */
export interface TemporalHcrActivityInput {
  identity: DoableIdentity;
}

/** Validated product context resolved by `validateHcrContext`. */
export interface ValidatedHcrContext {
  doableProjectId: string;
  doableWorkflowId: string;
  doableExecutionId: string;
  doableNodeId: string;
  executionStatus: string;
  nodeStatus: string;
}

/** Result of the single migration-ready node Activity boundary (skeleton). */
export interface HcrNodeBoundaryResult {
  doableExecutionId: string;
  doableNodeId: string;
  /** Always false in the skeleton; Agent 03 flips this when real cognition is wired. */
  nodeMigrated: boolean;
  reason: string;
}

/** Durable result returned by `hcrWorkflow` for correlation/debugging. */
export interface TemporalHcrResult {
  doableProjectId: string;
  doableWorkflowId: string;
  doableExecutionId: string;
  doableNodeId: string;
  executionStatus: string;
  nodeMigrated: boolean;
  temporalWorkflowId: string;
  /** Set once the real ARCHITECT node runs (null only for skeleton boundary). */
  artifactId?: string | null;
  artifactType?: string | null;
  nodeType?: string;
}

/**
 * Why deterministic: duplicate POST /chat calls must not fork product state.
 * The caller creates Doable Workflow/Execution/Node rows first, then starts
 * Temporal with this ID. A repeated trigger with the same executionId maps to
 * the same Temporal workflow instead of a second product execution.
 *
 * DECISION POINT for Agent 03/04: current Inngest path has NO dedup (each POST
 * creates a new execution). If strict parity is required, the trigger must keep
 * creating new executionIds. If fork-prevention is desired, the trigger should
 * reuse this ID with `WorkflowIdReusePolicy`. Do not decide here — mark only.
 */
export function buildHcrWorkflowId(identity: DoableIdentity): string {
  return `hcr-${identity.executionId}`;
}

/** Input to the real ARCHITECT node Activity (Agent 03 vertical slice). */
export interface RunArchitectNodeActivityInput {
  identity: DoableIdentity;
  prompt: string;
  inputArtifactId?: string | null;
}

/** Result of the real ARCHITECT node Activity. */
export interface ArchitectNodeActivityResult {
  doableProjectId: string;
  doableWorkflowId: string;
  doableExecutionId: string;
  doableNodeId: string;
  nodeType: string;
  artifactId: string | null;
  artifactType: string | null;
  nodeMigrated: true;
}
