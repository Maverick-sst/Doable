import path from "path";
import { Worker } from "@temporalio/worker";
import * as activities from "./activities/greetActivity";

async function run() {
  const worker = await Worker.create({
    workflowsPath: path.join(__dirname, "workflows", "greetWorkflow.ts"),
    activities,
    taskQueue: "greet-task-queue",
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  });

  await worker.run();
}

run().catch((error) => {
  console.error("Worker failed to start:", error);
  process.exit(1);
});
