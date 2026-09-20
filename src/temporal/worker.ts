import path from "path";
import { Worker } from "@temporalio/worker";
import * as greetActivities from "./activities/greetActivity";
import * as pilotActivities from "./activities/pilotActivity";
import * as hcrActivities from "./activities/hcrActivities";

// Focused cleanup (phase 00): worker previously hardcoded "greet-task-queue"
// while docs and the pilot trigger use TEMPORAL_TASK_QUEUE/pilot-queue.
// Read the same env so local Temporal, worker, and trigger agree.
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "pilot-queue";

async function run() {
  const worker = await Worker.create({
    workflowsPath: path.join(__dirname, "workflows", "index.ts"),
    activities: { ...greetActivities, ...pilotActivities, ...hcrActivities },
    taskQueue: TASK_QUEUE,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  });

  await worker.run();
}

run().catch((error) => {
  console.error("Worker failed to start:", error);
  process.exit(1);
});
