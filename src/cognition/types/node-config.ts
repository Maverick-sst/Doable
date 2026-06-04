import { NodeType, ArtifactType } from "@prisma/client";

export type ContextConfig = {
  // Which artifact types to fetch and inject into context
  consumedArtifactTypes: ArtifactType[];
  // Whether to include the project file tree
  includeFileTree: boolean;
  // Whether to run vector search for relevant files
  includeVectorSearch: boolean;
  // Whether to include recent message history (BUILD phase)
  includeMessageHistory: boolean;
};

export type NodeConfig = {
  nodeType: NodeType;
  // The artifact type this node produces
  outputArtifactType: ArtifactType | null;   // null for FE/BE (they produce files)
  // The artifact type(s) this node consumes
  consumedArtifactTypes: ArtifactType[];
  // The system prompt for this node
  systemPrompt: string;
  // Context assembly rules
  contextConfig: ContextConfig;
  // Whether this node uses file tools (create_file, edit_file, etc.)
  usesFileTools: boolean;
  // Max iterations for the agentic loop (only relevant for file-tool nodes)
  maxIterations: number;
  // Whether output should be JSON (for artifact-producing nodes)
  // or freeform tool calls (for file-producing nodes)
  outputMode: "structured_json" | "tool_calls";
};
