import type { NodeType } from "@prisma/client";

/**
 * Explicit cognitive-role identifiers for the six Doable agents (§5A catalog).
 * Deliberately NOT the Prisma `NodeType`: a workflow node is a scheduling
 * unit while an agent type is a cognitive role, and the two diverge today
 * (`NodeType.PLANNER` performs staff-engineer cognition). The node→agent
 * mapping lives in `resolver.ts` so the divergence stays visible instead of
 * collapsing into a silent rename.
 */
export type AgentType =
  | "ARCHITECT"
  | "RESEARCHER"
  | "PRD_REVIEWER"
  | "STAFF_ENGINEER"
  | "FRONTEND_ENG"
  | "BACKEND_ENG";

/** Declarative capabilities: what the agent may request. Never executes. */
export type AgentCapability =
  | "research"
  | "filesystem-access"
  | "code-generation"
  | "artifact-creation"
  | "database-reads";

/**
 * Tool eligibility by name only. Names must match `lib/tools.ts`; definitions
 * stay out so configuration can never preload or invoke the tool catalog —
 * the future discovery system resolves these names to a small loaded set.
 */
export interface ToolPolicyReference {
  eligibleTools: string[];
}

/**
 * Model preferences/constraints for the future Model Router. Expresses wishes,
 * never invocation: no provider calls, no env reads, no model strings bound
 * to a vendor contract the router doesn't own yet.
 */
export type ModelTaskProfile = "reasoning" | "planning" | "implementation";

export interface ModelPolicyReference {
  taskProfile: ModelTaskProfile;
  allowFallback: boolean;
}

/**
 * Execution limits mirrored from the current registry values. The registry
 * remains the behavioral owner until the Agent Loop consumes this boundary;
 * values are copied, not referenced, so resolution stays dependency-free.
 */
export interface ExecutionPolicyReference {
  maxIterations: number;
}

/** Opaque experiment variant marker. No assignment logic lives here. */
export interface ExperimentReference {
  variant: string;
}

/**
 * Stable agent description. Owns identity/role, instructions, capabilities,
 * and policy references — never execution identity (`executionId`,
 * `workflowId`, `nodeId`, run IDs), never dynamic context (prompt, history,
 * artifacts, memory, tool results). See §4 of the brief.
 */
export interface AgentConfig {
  agentId: string;
  agentType: AgentType;
  instructions: string;
  capabilities: AgentCapability[];
  toolPolicy: ToolPolicyReference;
  modelPolicy: ModelPolicyReference;
  executionPolicy: ExecutionPolicyReference;
  experiment?: ExperimentReference;
  version?: string;
}

/** Input accepted by the configuration provider (§12 runtime contract). */
export interface ResolveAgentConfigInput {
  agentType: AgentType;
  /** Reserved for future DB/experiment-backed resolution; never stored. */
  projectId?: string;
  /** Reserved for future DB/experiment-backed resolution; never stored. */
  executionId?: string;
  /** Optional variant marker; recorded verbatim, never assigned here. */
  experimentVariant?: string;
}

/** Explicit failure for unknown agent types (no silent defaults). */
export class UnknownAgentTypeError extends Error {
  readonly agentType: string;

  constructor(agentType: string) {
    super(`Unknown agent type: ${agentType}`);
    this.name = "UnknownAgentTypeError";
    this.agentType = agentType;
  }
}

/** Explicit failure for node types with no mapped agent (§5F protocol). */
export class UnmappedNodeTypeError extends Error {
  readonly nodeType: NodeType;

  constructor(nodeType: NodeType) {
    super(`No agent mapped for node type: ${String(nodeType)}`);
    this.name = "UnmappedNodeTypeError";
    this.nodeType = nodeType;
  }
}
