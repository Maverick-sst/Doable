import * as wf from "@temporalio/workflow";

const { greetActivity } = wf.proxyActivities<
  typeof import("../activities/greetActivity")
>({
  startToCloseTimeout: "30s",
});

export async function greetWorkflow(name: string): Promise<string> {
  return greetActivity(name);
}
