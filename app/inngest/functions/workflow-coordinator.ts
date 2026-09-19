import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { NodeStatus, WorkflowStatus, ExecutionStatus, ProjectStatus, ArtifactType } from "@prisma/client";
import { HCR_TRANSITION_MAP } from "@/src/runtime/workflows/hcr/transition-map";

export const workflowCoordinatorFunction = inngest.createFunction(
  { id: "workflow-coordinator", retries: 2, triggers: [{ event: "node/completed" }] },
  async ({ event, step }) => {
    const { outputArtifactType, workflowId, executionId, projectId, userId, prompt } = event.data;

    await step.run("coordinate-next-node", async () => {
      // 1. Check if the output artifact type has transition mapping
      const transition = outputArtifactType ? HCR_TRANSITION_MAP[outputArtifactType as ArtifactType] : null;

      if (!transition) {
        // No next node = all done. Finalize.
        if (outputArtifactType === null) {
          // Count running/created nodes for this execution
          const runningNodes = await prisma.node.count({
            where: {
              executionId,
              status: { in: [NodeStatus.CREATED, NodeStatus.RUNNING] },
            },
          });
          if (runningNodes > 0) return; // Wait for other parallel node(s) to complete
        }

        await finalizeWorkflow(workflowId, executionId, projectId);
        return;
      }

      // 3. Create next nodes in DB
      for (const nodeType of transition.nextNodes) {
        const node = await prisma.node.create({
          data: {
            executionId,
            type: nodeType,
            status: NodeStatus.CREATED,
            order: transition.order,
          },
        });

        // 4. Emit node.created runtime event
        await prisma.runtimeEvent.create({
          data: {
            executionId,
            nodeId: node.id,
            type: "node.created",
            payload: { nodeId: node.id, type: nodeType, nodeType },
          },
        });

        // 5. Fire node/execute inngest event
        await inngest.send({
          name: "node/execute",
          data: {
            projectId,
            userId,
            workflowId,
            executionId,
            nodeId: node.id,
            nodeType,
            prompt,
            inputArtifactId: event.data.outputArtifactId,
          },
        });
      }
    });
  }
);

async function finalizeWorkflow(workflowId: string, executionId: string, projectId: string) {
  await prisma.execution.update({
    where: { id: executionId },
    data: { status: ExecutionStatus.COMPLETED },
  });
  await prisma.workflow.update({
    where: { id: workflowId },
    data: { status: WorkflowStatus.COMPLETED },
  });
  await prisma.project.update({
    where: { id: projectId },
    data: { status: ProjectStatus.IDLE },
  });
  await prisma.runtimeEvent.createMany({
    data: [
      { executionId, type: "execution.completed", payload: { executionId } },
      { executionId, type: "workflow.completed", payload: { workflowId } },
    ],
  });
}
