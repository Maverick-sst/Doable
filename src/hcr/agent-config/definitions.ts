import { ArtifactType, NodeType } from "@prisma/client";
import { resolveNodeBudget } from "@/src/runtime/budgets";
import { AGENT_CATALOG_VERSION } from "./constants";
import { AGENT_PROMPTS } from "./prompts";
import { KNOWN_TOOL_NAMES } from "./tool-names";
import type {
  AgentConfig,
  AgentType,
  ModelTaskProfile,
  OutputContract,
} from "./types";
import { validateAgentConfig } from "./validation";

interface DefinitionSource {
  agentId: string;
  agentType: AgentType;
  nodeType: NodeType;
  taskProfile: ModelTaskProfile;
  outputContract: OutputContract;
  eligibleTools: string[];
}

const FILE_TOOL_NAMES: string[] = [...KNOWN_TOOL_NAMES];

const STRUCTURED_OUTPUT = (artifactType: ArtifactType): OutputContract => ({
  artifactType,
  mode: "structured_json",
});

const TOOL_OUTPUT: OutputContract = { artifactType: null, mode: "tool_calls" };

// The six existing roles, in workflow order. Node type is recorded so the
// PLANNER → STAFF_ENGINEER divergence stays explicit (§5B).
const SOURCES: DefinitionSource[] = [
  {
    agentId: "architect",
    agentType: "ARCHITECT",
    nodeType: NodeType.ARCHITECT,
    taskProfile: "reasoning",
    outputContract: STRUCTURED_OUTPUT(ArtifactType.ARCHITECTURE_SPEC),
    eligibleTools: [],
  },
  {
    agentId: "researcher",
    agentType: "RESEARCHER",
    nodeType: NodeType.RESEARCH,
    taskProfile: "reasoning",
    outputContract: STRUCTURED_OUTPUT(ArtifactType.RESEARCH_DOSSIER),
    eligibleTools: [],
  },
  {
    agentId: "prd-reviewer",
    agentType: "PRD_REVIEWER",
    nodeType: NodeType.PRD_REVIEWER,
    taskProfile: "reasoning",
    outputContract: STRUCTURED_OUTPUT(ArtifactType.APPROVED_PRD),
    eligibleTools: [],
  },
  {
    agentId: "staff-engineer",
    agentType: "STAFF_ENGINEER",
    nodeType: NodeType.PLANNER,
    taskProfile: "planning",
    outputContract: STRUCTURED_OUTPUT(ArtifactType.EXECUTION_PLAN),
    eligibleTools: [],
  },
  {
    agentId: "frontend-eng",
    agentType: "FRONTEND_ENG",
    nodeType: NodeType.FRONTEND_ENG,
    taskProfile: "implementation",
    outputContract: TOOL_OUTPUT,
    eligibleTools: FILE_TOOL_NAMES,
  },
  {
    agentId: "backend-eng",
    agentType: "BACKEND_ENG",
    nodeType: NodeType.BACKEND_ENG,
    taskProfile: "implementation",
    outputContract: TOOL_OUTPUT,
    eligibleTools: FILE_TOOL_NAMES,
  },
  {
    agentId: "repair-eng",
    agentType: "REPAIR_ENG",
    nodeType: NodeType.REPAIR,
    taskProfile: "implementation",
    outputContract: TOOL_OUTPUT,
    eligibleTools: FILE_TOOL_NAMES,
  },
];

function buildConfig(source: DefinitionSource): AgentConfig {
  const prompt = AGENT_PROMPTS[source.agentType];
  const usesFileTools = source.eligibleTools.length > 0;

  // Validation runs while the catalog is built, so a malformed definition
  // cannot reach an execution path.
  return validateAgentConfig(
    {
      agentId: source.agentId,
      agentType: source.agentType,
      instructions: prompt.content,
      prompt: {
        id: prompt.id,
        version: prompt.version,
        hash: prompt.hash,
      },
      capabilities: usesFileTools
        ? ["filesystem-access", "code-generation", "database-reads"]
        : ["research", "artifact-creation", "database-reads"],
      toolPolicy: { eligibleTools: [...source.eligibleTools] },
      modelPolicy: { taskProfile: source.taskProfile, allowFallback: true },
      executionPolicy: {
        maxIterations: resolveNodeBudget(source.outputContract.mode).maxIterations,
      },
      outputContract: source.outputContract,
      version: AGENT_CATALOG_VERSION,
    },
    `catalog:${source.agentType}`,
  );
}

export const AGENT_DEFINITIONS: Record<AgentType, AgentConfig> =
  Object.fromEntries(
    SOURCES.map((source) => [source.agentType, buildConfig(source)]),
  ) as Record<AgentType, AgentConfig>;

/** Node type each definition was extracted from (the §5B mapping). */
export const AGENT_NODE_TYPES: Record<AgentType, NodeType> = Object.fromEntries(
  SOURCES.map((source) => [source.agentType, source.nodeType]),
) as Record<AgentType, NodeType>;
