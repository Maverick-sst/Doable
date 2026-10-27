import { getTemporalClient, getTemporalTaskQueue } from "./client";
import { memoryCurationWorkflow } from "./workflows/memoryCurationWorkflow";
import type { MemoryCurationWorkflowInput } from "./contracts/memory";

const MEMORY_WORKFLOW_TIMEOUT = "30 minutes";

function isAlreadyStarted(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "WorkflowExecutionAlreadyStartedError" ||
      error.message.includes("already started"))
  );
}

/**
 * Starts a memory-curation workflow. Callers treat failure as best-effort:
 * memory maintenance must never fail a build or a discovery turn.
 */
export async function startMemoryCurationWorkflow(
  input: MemoryCurationWorkflowInput,
): Promise<{ workflowId: string; started: boolean }> {
  const client = getTemporalClient();
  const workflowId = `memory-curation-${input.projectId}-${
    input.executionId ?? input.trigger
  }`;

  try {
    await client.workflow.start(memoryCurationWorkflow, {
      taskQueue: getTemporalTaskQueue(),
      workflowId,
      workflowExecutionTimeout: MEMORY_WORKFLOW_TIMEOUT,
      args: [input],
    });
    return { workflowId, started: true };
  } catch (error) {
    if (isAlreadyStarted(error)) {
      return { workflowId, started: false };
    }
    throw error;
  }
}
