import { getTemporalClient } from "../src/temporal/client";
import { pilotWorkflow } from "../src/temporal/workflows/pilotWorkflow";

async function main() {
  const client = getTemporalClient();

  const workflowId = `pilot-workflow-${Date.now()}`;

  const result = await client.workflow.execute(pilotWorkflow, {
    taskQueue: "greet-task-queue",
    workflowId,
    args: [
      {
        identity: {
          workflowId: "workflow-pilot-001",
          executionId: "execution-pilot-001",
          nodeId: "node-pilot-001",
          projectId: "project-pilot-001",
          userId: "user-pilot-001",
          taskId: "pilot-task-001",
        },
      },
    ],
  });

  console.log("Pilot workflow result:", result);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
