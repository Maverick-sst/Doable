import { serve } from "inngest/next";
import { inngest } from "@/app/inngest/client";
import { agentFunction } from "@/app/inngest/functions/agent";
import { embedFileFunction } from "@/app/inngest/functions/embedFile";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [agentFunction, embedFileFunction]
});