import { getTemporalClient } from "../src/temporal/client";
import { greetWorkflow } from "../src/temporal/workflows/greetWorkflow";

async function main() {
  const client = getTemporalClient();
  const result = await client.workflow.execute(greetWorkflow, {
    taskQueue: "greet-task-queue",
    args: ["World"],
    workflowId: `greet-workflow-${Date.now()}`,
  });

  console.log(result);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
