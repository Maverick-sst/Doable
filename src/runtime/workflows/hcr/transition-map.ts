import { ArtifactType, NodeType } from "@prisma/client";

export type TransitionEntry = {
  nextNodes: NodeType[];     // Usually 1, except EXECUTION_PLAN which spawns 2
  order: number;             // Node order in the execution
};

export const HCR_TRANSITION_MAP: Partial<Record<ArtifactType, TransitionEntry>> = {
  [ArtifactType.ARCHITECTURE_SPEC]: {
    nextNodes: [NodeType.RESEARCH],
    order: 2,
  },
  [ArtifactType.RESEARCH_DOSSIER]: {
    nextNodes: [NodeType.PRD_REVIEWER],
    order: 3,
  },
  [ArtifactType.APPROVED_PRD]: {
    nextNodes: [NodeType.PLANNER],
    order: 4,
  },
  [ArtifactType.EXECUTION_PLAN]: {
    nextNodes: [NodeType.FRONTEND_ENG, NodeType.BACKEND_ENG],
    order: 5,
  },
};
