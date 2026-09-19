import { inngest } from "../../client";
import { NodeType } from "@prisma/client";
import { AGENT_REGISTRY } from "@/src/cognition/agent-registry";
import { executeNode } from "@/src/cognition/node-executor";
import { handleFailure } from "@/lib/handleFailure";

export const prdReviewerNodeFunction = inngest.createFunction(
  {
    id: "prd-reviewer-node",
    retries: 3,
    onFailure: async ({ event }) => {
      const { executionId, nodeId, workflowId } = event.data.event.data;
      await handleFailure(executionId, nodeId, workflowId);
    },
    triggers: [{ event: "node/execute" }],
  },
  async ({ event, step }) => {
    if (event.data.nodeType !== NodeType.PRD_REVIEWER) return;

    const result = await step.run("execute-prd-reviewer", async () => {
      return executeNode({
        projectId: event.data.projectId,
        userId: event.data.userId,
        workflowId: event.data.workflowId,
        executionId: event.data.executionId,
        nodeId: event.data.nodeId,
        prompt: event.data.prompt,
        inputArtifactId: event.data.inputArtifactId,
        nodeConfig: AGENT_REGISTRY[NodeType.PRD_REVIEWER]!,
      });
    });

    return result;
  }
);
