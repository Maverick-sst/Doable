import { ArtifactType, NodeType } from "@prisma/client";
import {
  AGENT_DEFINITIONS,
  agentTypeForNode,
} from "@/src/hcr/agent-config";
import type { ContextConfig, NodeConfig } from "./types/node-config";

/**
 * HCR's node-level *context* contract: which artifacts the Context Engine may
 * inject and whether it may add the file tree, vector hits, or message
 * history. It is deliberately separate from `AgentConfig`: agent
 * configuration owns identity, instructions and policy; context ownership
 * stays with the Context Engine (d-3 Agent 01 §5C).
 */
interface NodeContextContract {
  nodeType: NodeType;
  context: ContextConfig;
}

const CONTEXT_CONTRACTS: NodeContextContract[] = [
  {
    nodeType: NodeType.ARCHITECT,
    context: {
      consumedArtifactTypes: [ArtifactType.DISCOVERY_REQUIREMENT],
      includeFileTree: false,
      includeVectorSearch: false,
      includeMessageHistory: false,
    },
  },
  {
    nodeType: NodeType.RESEARCH,
    context: {
      consumedArtifactTypes: [ArtifactType.ARCHITECTURE_SPEC],
      includeFileTree: false,
      includeVectorSearch: false,
      includeMessageHistory: false,
    },
  },
  {
    nodeType: NodeType.PRD_REVIEWER,
    context: {
      consumedArtifactTypes: [ArtifactType.RESEARCH_DOSSIER],
      includeFileTree: false,
      includeVectorSearch: false,
      includeMessageHistory: false,
    },
  },
  {
    nodeType: NodeType.PLANNER,
    context: {
      consumedArtifactTypes: [ArtifactType.APPROVED_PRD],
      includeFileTree: false,
      includeVectorSearch: false,
      includeMessageHistory: false,
    },
  },
  {
    nodeType: NodeType.FRONTEND_ENG,
    context: {
      consumedArtifactTypes: [ArtifactType.EXECUTION_PLAN],
      includeFileTree: true,
      includeVectorSearch: true,
      includeMessageHistory: false,
    },
  },
  {
    nodeType: NodeType.BACKEND_ENG,
    context: {
      consumedArtifactTypes: [ArtifactType.EXECUTION_PLAN],
      includeFileTree: true,
      includeVectorSearch: true,
      includeMessageHistory: false,
    },
  },
  {
    nodeType: NodeType.REPAIR,
    context: {
      consumedArtifactTypes: [
        ArtifactType.APPROVED_PRD,
        ArtifactType.EXECUTION_PLAN,
      ],
      includeFileTree: true,
      includeVectorSearch: true,
      includeMessageHistory: false,
    },
  },
];

function buildNodeConfig({
  nodeType,
  context,
}: NodeContextContract): NodeConfig {
  const agent = AGENT_DEFINITIONS[agentTypeForNode(nodeType)];
  return {
    nodeType,
    outputArtifactType: agent.outputContract.artifactType,
    consumedArtifactTypes: [...context.consumedArtifactTypes],
    systemPrompt: agent.instructions,
    contextConfig: {
      ...context,
      consumedArtifactTypes: [...context.consumedArtifactTypes],
    },
    usesFileTools: agent.toolPolicy.eligibleTools.length > 0,
    maxIterations: agent.executionPolicy.maxIterations,
    outputMode: agent.outputContract.mode,
  };
}

/**
 * Workflow-facing view of the catalog. This registry is *derived*, not a
 * source of truth: instructions and execution policy come from
 * `AGENT_DEFINITIONS`, so the two surfaces cannot drift. Kept as a named
 * export because the Temporal activity and resume path consume `NodeConfig`.
 */
export const AGENT_REGISTRY: Partial<Record<NodeType, NodeConfig>> =
  Object.fromEntries(
    CONTEXT_CONTRACTS.map((contract) => [
      contract.nodeType,
      buildNodeConfig(contract),
    ]),
  ) as Partial<Record<NodeType, NodeConfig>>;
