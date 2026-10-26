import type { NodeType } from "@prisma/client";
import { AGENT_DEFINITIONS, AGENT_NODE_TYPES } from "./definitions";
import {
  UnknownAgentTypeError,
  UnmappedNodeTypeError,
} from "./types";
import type { AgentConfig, AgentType } from "./types";

const NODE_TO_AGENT: Record<string, AgentType> = Object.fromEntries(
  (Object.entries(AGENT_NODE_TYPES) as Array<[AgentType, NodeType]>).map(
    ([agentType, nodeType]) => [String(nodeType), agentType],
  ),
);

/**
 * Maps a workflow node to its cognitive role. The one non-identity entry —
 * `PLANNER` → `STAFF_ENGINEER` — is preserved here explicitly (§5B) instead
 * of being renamed away.
 */
export function agentTypeForNode(nodeType: NodeType): AgentType {
  const agentType = NODE_TO_AGENT[String(nodeType)];
  if (!agentType) {
    throw new UnmappedNodeTypeError(nodeType);
  }
  return agentType;
}

/** Looks up the static definition; unknown types fail explicitly. */
export function resolveDefinition(agentType: AgentType): AgentConfig {
  const definition = (AGENT_DEFINITIONS as Record<string, AgentConfig>)[
    agentType as string
  ];
  if (!definition) {
    throw new UnknownAgentTypeError(agentType as string);
  }
  return definition;
}
