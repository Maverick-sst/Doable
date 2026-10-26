import { z } from "zod";
import { callLLM } from "./llm";
import type { LLmMessage } from "@/src/shared/types";

const DiscoveryResponseSchema = z.object({
  message: z.string().min(1),
  discoveryComplete: z.boolean(),
  requirements: z.record(z.string(), z.unknown()).optional(),
  techStack: z.record(z.string(), z.unknown()).optional(),
});

export type DiscoveryAgentResponse = z.infer<typeof DiscoveryResponseSchema>;

export async function callDiscoveryAgent(
  domain: string,
  prompt: string,
  history: { role: string; content: string }[],
): Promise<DiscoveryAgentResponse> {
  const systemPrompt = `
You are a requirement discovery agent for Doable, an AI software engineering platform.
Domain: ${domain}

Your job: ask focused questions that change architecture, scope, data, security,
or acceptance criteria. Ask ONE question at a time. Be concise and non-technical.
If the user says "surprise me", choose sensible defaults immediately.

When you have enough information, respond with ONLY this exact JSON:
{
  "message": "Great! I have everything I need to start building...",
  "discoveryComplete": true,
  "requirements": {
    "description": "...",
    "features": ["feature1", "feature2"],
    "userFlows": ["flow1"],
    "dataEntities": ["Entity1"],
    "authRequirements": ["email/password"],
    "integrations": [],
    "technicalConstraints": [],
    "productConstraints": [],
    "assumptions": [],
    "ambiguities": [],
    "acceptanceCriteria": ["criterion1"]
  },
  "techStack": {
    "frontend": "React + Vite + Tailwind",
    "backend": "Node.js + Express",
    "database": "PostgreSQL",
    "auth": "local"
  }
}

Until you have enough information, respond with ONLY this JSON:
{ "message": "your question here", "discoveryComplete": false }

NEVER explain yourself. NEVER start building. NEVER use tools. ONLY output JSON.
`;

  const messages: LLmMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((message) => ({
      role: (message.role === "USER" ? "user" : "assistant") as
        | "user"
        | "assistant",
      content: message.content,
    })),
    { role: "user", content: prompt },
  ];

  const response = await callLLM(messages, [], {
    responseFormat: "json",
  });
  const rawContent = response.content ?? "";

  try {
    const parsed = DiscoveryResponseSchema.safeParse(JSON.parse(rawContent));
    if (parsed.success) return parsed.data;
  } catch {
    // A non-JSON response is treated as a follow-up question, never as a
    // completed discovery.
  }

  return { message: rawContent.trim() || "Could you tell me more?", discoveryComplete: false };
}