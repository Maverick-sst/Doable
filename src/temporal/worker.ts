import path from "node:path";
import { Worker } from "@temporalio/worker";
import * as greetActivities from "./activities/greetActivity";
import * as pilotActivities from "./activities/pilotActivity";
import * as hcrActivities from "./activities/hcrActivities";

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "pilot-queue";

function assertWorkerEnvironment() {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (
    !process.env.OLLAMA_BASE_URL &&
    !process.env.OPENROUTER_API_KEY &&
    process.env.MODEL_PROVIDER !== "ollama"
  ) {
    missing.push("OLLAMA_BASE_URL or OPENROUTER_API_KEY");
  }
  if (missing.length > 0) {
    console.warn(
      `[temporal-worker] Missing optional environment: ${missing.join(", ")}. ` +
        "Activities that need them will report a clear error.",
    );
  }
}

async function run() {
  assertWorkerEnvironment();

  const worker = await Worker.create({
    workflowsPath: path.join(__dirname, "workflows", "index.ts"),
    activities: { ...greetActivities, ...pilotActivities, ...hcrActivities },
    taskQueue: TASK_QUEUE,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  });

  const shutdown = async () => {
    await worker.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(
    `[temporal-worker] polling queue=${TASK_QUEUE} namespace=${
      process.env.TEMPORAL_NAMESPACE ?? "default"
    } host=${process.env.TEMPORAL_HOST ?? "127.0.0.1:7233"}`,
  );
  await worker.run();
}

run().catch((error) => {
  console.error(
    "[temporal-worker] failed to start:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});