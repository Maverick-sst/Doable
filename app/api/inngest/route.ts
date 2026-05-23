import { serve } from "inngest/next";
import { inngest } from "@/app/inngest/client";
import { hcrAgentFunction } from "@/app/inngest/functions/hcr-agent";
import { embedFileFunction } from "@/app/inngest/functions/embedFile";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [hcrAgentFunction, embedFileFunction],
});