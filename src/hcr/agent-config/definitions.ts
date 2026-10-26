import { NodeType } from "@prisma/client";
import { AGENT_REGISTRY } from "@/src/cognition/agent-registry";
import {
  ARCHITECT_SYSTEM_PROMPT,
  RESEARCHER_SYSTEM_PROMPT,
  PRD_REVIEWER_SYSTEM_PROMPT,
  STAFF_ENGINEER_SYSTEM_PROMPT,
  FRONTEND_ENGINEER_SYSTEM_PROMPT,
  BACKEND_ENGINEER_SYSTEM_PROMPT,
} from "@/src/cognition/prompts";
import type {
  AgentConfig,
  AgentType,
  ModelTaskProfile,
} from "./types";

interface DefinitionSource {
  agentId: string;
  agentType: AgentType;
  nodeType: NodeType;
  instructions: string;
  taskProfile: ModelTaskProfile;
}

// Prompts and limits are referenced — never copied — from the live registry
// and prompt modules, so the equality tests prove behavioral preservation
// instead of trusting a duplicated string.
const SOURCES: DefinitionSource[] = [
  {
    agentId: "architect",
    agentType: "ARCHITECT",
    nodeType: NodeType.ARCHITECT,
    instructions: ARCHITECT_SYSTEM_PROMPT,
    taskProfile: "reasoning",
  },
  {
    agentId: "researcher",
    agentType: "RESEARCHER",
    nodeType: NodeType.RESEARCH,
    instructions: RESEARCHER_SYSTEM_PROMPT,
    taskProfile: "reasoning",
  },
  {
    agentId: "prd-reviewer",
    agentType: "PRD_REVIEWER",
    nodeType: NodeType.PRD_REVIEWER,
    instructions: PRD_REVIEWER_SYSTEM_PROMPT,
    taskProfile: "reasoning",
  },
  {
    agentId: "staff-engineer",
    agentType: "STAFF_ENGINEER",
    nodeType: NodeType.PLANNER,
    instructions: STAFF_ENGINEER_SYSTEM_PROMPT,
    taskProfile: "planning",
  },
  {
    agentId: "frontend-eng",
    agentType: "FRONTEND_ENG",
    nodeType: NodeType.FRONTEND_ENG,
    instructions: FRONTEND_ENGINEER_SYSTEM_PROMPT,
    taskProfile: "implementation",
  },
  {
    agentId: "backend-eng",
    agentType: "BACKEND_ENG",
    nodeType: NodeType.BACKEND_ENG,
    instructions: BACKEND_ENGINEER_SYSTEM_PROMPT,
    taskProfile: "implementation",
  },
];

const FILE_TOOL_NAMES = [
  "create_file",
  "edit_file",
  "read_file",
  "delete_file",
  "mark_complete",
];

function buildConfig(source: DefinitionSource): AgentConfig {
  const registryEntry = AGENT_REGISTRY[source.nodeType];
  if (!registryEntry) {
    throw new Error(
      `AGENT_REGISTRY has no entry for ${String(source.nodeType)}`,
    );
  }

  const usesFileTools = registryEntry.usesFileTools;

  return {
    agentId: source.agentId,
    agentType: source.agentType,
    instructions: source.instructions,
    capabilities: usesFileTools
      ? ["filesystem-access", "code-generation", "database-reads"]
      : ["research", "artifact-creation", "database-reads"],
    toolPolicy: { eligibleTools: usesFileTools ? [...FILE_TOOL_NAMES] : [] },
    modelPolicy: { taskProfile: source.taskProfile, allowFallback: true },
    executionPolicy: { maxIterations: registryEntry.maxIterations },
    version: "1",
  };
}

export const AGENT_DEFINITIONS: Record<AgentType, AgentConfig> = Object.fromEntries(
  SOURCES.map((source) => [source.agentType, buildConfig(source)]),
) as Record<AgentType, AgentConfig>;

/** Node type each definition was extracted from (the §5B mapping). */
export const AGENT_NODE_TYPES: Record<AgentType, NodeType> = Object.fromEntries(
  SOURCES.map((source) => [source.agentType, source.nodeType]),
) as Record<AgentType, NodeType>;
