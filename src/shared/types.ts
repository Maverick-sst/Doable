import { NodeType, ArtifactType } from "@prisma/client";

export type RelevantFile = {
    id: string
    path: string
    content: string
}

export type LLmMessage = 
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;

export type SystemMessage = {
    role: "system";
    content: string;
};
export type UserMessage = {
    role: "user";
    content: string;
}

export type AssistantMessage = {
    role: "assistant";
    content: string | null;
    tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

export type ToolMessage = {
    role: "tool";
    content: string;
    tool_call_id: string;
};

export type NodeExecuteEvent = {
  name: "node/execute";
  data: {
    projectId: string;
    userId: string;
    workflowId: string;
    executionId: string;
    nodeId: string;
    nodeType: NodeType;
    prompt: string;
    inputArtifactId: string | null;
  };
};

export type NodeCompletedEvent = {
  name: "node/completed";
  data: {
    projectId: string;
    userId: string;
    workflowId: string;
    executionId: string;
    nodeType: NodeType;
    outputArtifactId: string | null;
    outputArtifactType: ArtifactType | null;
    prompt: string;
  };
};

