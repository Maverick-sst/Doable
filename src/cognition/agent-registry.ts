import { NodeType, ArtifactType } from "@prisma/client";
import { NodeConfig } from "./types/node-config";
import {
  ARCHITECT_SYSTEM_PROMPT,
  RESEARCHER_SYSTEM_PROMPT,
  PRD_REVIEWER_SYSTEM_PROMPT,
  STAFF_ENGINEER_SYSTEM_PROMPT,
  FRONTEND_ENGINEER_SYSTEM_PROMPT,
  BACKEND_ENGINEER_SYSTEM_PROMPT,
} from "./prompts";

export const AGENT_REGISTRY: Partial<Record<NodeType, NodeConfig>> = {
  [NodeType.ARCHITECT]: {
    nodeType: NodeType.ARCHITECT,
    outputArtifactType: ArtifactType.ARCHITECTURE_SPEC,
    consumedArtifactTypes: [ArtifactType.DISCOVERY_REQUIREMENT],
    systemPrompt: ARCHITECT_SYSTEM_PROMPT,
    contextConfig: {
      consumedArtifactTypes: [ArtifactType.DISCOVERY_REQUIREMENT],
      includeFileTree: false,
      includeVectorSearch: false,
      includeMessageHistory: false,
    },
    usesFileTools: false,
    maxIterations: 1,
    outputMode: "structured_json",
  },

  [NodeType.RESEARCH]: {
    nodeType: NodeType.RESEARCH,
    outputArtifactType: ArtifactType.RESEARCH_DOSSIER,
    consumedArtifactTypes: [ArtifactType.ARCHITECTURE_SPEC],
    systemPrompt: RESEARCHER_SYSTEM_PROMPT,
    contextConfig: {
      consumedArtifactTypes: [ArtifactType.ARCHITECTURE_SPEC],
      includeFileTree: false,
      includeVectorSearch: false,
      includeMessageHistory: false,
    },
    usesFileTools: false,
    maxIterations: 1,
    outputMode: "structured_json",
  },

  [NodeType.PRD_REVIEWER]: {
    nodeType: NodeType.PRD_REVIEWER,
    outputArtifactType: ArtifactType.APPROVED_PRD,
    consumedArtifactTypes: [ArtifactType.RESEARCH_DOSSIER],
    systemPrompt: PRD_REVIEWER_SYSTEM_PROMPT,
    contextConfig: {
      consumedArtifactTypes: [ArtifactType.RESEARCH_DOSSIER],
      includeFileTree: false,
      includeVectorSearch: false,
      includeMessageHistory: false,
    },
    usesFileTools: false,
    maxIterations: 1,
    outputMode: "structured_json",
  },

  [NodeType.PLANNER]: {
    nodeType: NodeType.PLANNER,
    outputArtifactType: ArtifactType.EXECUTION_PLAN,
    consumedArtifactTypes: [ArtifactType.APPROVED_PRD],
    systemPrompt: STAFF_ENGINEER_SYSTEM_PROMPT,
    contextConfig: {
      consumedArtifactTypes: [ArtifactType.APPROVED_PRD],
      includeFileTree: false,
      includeVectorSearch: false,
      includeMessageHistory: false,
    },
    usesFileTools: false,
    maxIterations: 1,
    outputMode: "structured_json",
  },

  [NodeType.FRONTEND_ENG]: {
    nodeType: NodeType.FRONTEND_ENG,
    outputArtifactType: null,
    consumedArtifactTypes: [ArtifactType.EXECUTION_PLAN],
    systemPrompt: FRONTEND_ENGINEER_SYSTEM_PROMPT,
    contextConfig: {
      consumedArtifactTypes: [ArtifactType.EXECUTION_PLAN],
      includeFileTree: true,
      includeVectorSearch: true,
      includeMessageHistory: false,
    },
    usesFileTools: true,
    maxIterations: 20,
    outputMode: "tool_calls",
  },

  [NodeType.BACKEND_ENG]: {
    nodeType: NodeType.BACKEND_ENG,
    outputArtifactType: null,
    consumedArtifactTypes: [ArtifactType.EXECUTION_PLAN],
    systemPrompt: BACKEND_ENGINEER_SYSTEM_PROMPT,
    contextConfig: {
      consumedArtifactTypes: [ArtifactType.EXECUTION_PLAN],
      includeFileTree: true,
      includeVectorSearch: true,
      includeMessageHistory: false,
    },
    usesFileTools: true,
    maxIterations: 20,
    outputMode: "tool_calls",
  },
};
