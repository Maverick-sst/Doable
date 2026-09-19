import { serve } from "inngest/next";
import { inngest } from "@/app/inngest/client";
import { hcrAgentFunction } from "@/app/inngest/functions/hcr-agent";
import { embedFileFunction } from "@/app/inngest/functions/embedFile";
import { workflowCoordinatorFunction } from "@/app/inngest/functions/workflow-coordinator";
import { architectNodeFunction } from "@/app/inngest/functions/nodes/architect-node";
import { researcherNodeFunction } from "@/app/inngest/functions/nodes/researcher-node";
import { prdReviewerNodeFunction } from "@/app/inngest/functions/nodes/prd-reviewer-node";
import { staffEngineerNodeFunction } from "@/app/inngest/functions/nodes/staff-engineer-node";
import { frontendEngineerNodeFunction } from "@/app/inngest/functions/nodes/frontend-engineer-node";
import { backendEngineerNodeFunction } from "@/app/inngest/functions/nodes/backend-engineer-node";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    hcrAgentFunction,
    embedFileFunction,
    workflowCoordinatorFunction,
    architectNodeFunction,
    researcherNodeFunction,
    prdReviewerNodeFunction,
    staffEngineerNodeFunction,
    frontendEngineerNodeFunction,
    backendEngineerNodeFunction,
  ],
});