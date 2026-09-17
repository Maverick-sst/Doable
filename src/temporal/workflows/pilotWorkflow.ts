import * as wf from "@temporalio/workflow";
import type { TemporalPilotWorkflowInput } from "../contracts/types";

const { pilotActivity } = wf.proxyActivities<
  typeof import("../activities/pilotActivity")
>({
  startToCloseTimeout: "30s",
});

export interface PilotWorkflowResult {
  doableExecutionId: string;
  status: string;
}

export async function pilotWorkflow(
  input: TemporalPilotWorkflowInput,
): Promise<PilotWorkflowResult> {
  const activityResult = await pilotActivity({
    identity: input.identity,
    payload: {},
  });

  return {
    doableExecutionId: activityResult.doableExecutionId,
    status: activityResult.finalStatus,
  };
}
