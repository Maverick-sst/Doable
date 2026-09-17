import path from "path";
import { Worker } from "@temporalio/worker";
import * as greetActivities from "./activities/greetActivity";
import * as pilotActivities from "./activities/pilotActivity";

async function run() {
  const worker = await Worker.create({
    workflowsPath: path.join(__dirname, "workflows", "index.ts"),
    activities: { ...greetActivities, ...pilotActivities },
    taskQueue: "greet-task-queue",
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  });

  await worker.run();
}

run().catch((error) => {
  console.error("Worker failed to start:", error);
  process.exit(1);
});
