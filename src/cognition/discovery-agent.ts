import { callLLM } from "./llm";
import { LLmMessage } from "@/src/shared/types";

interface DiscoveryAgentResponse {
  message: string;
  discoveryComplete: boolean;
  requirements?: Record<string, unknown>;
  techStack?: Record<string, unknown>;
}

export async function callDiscoveryAgent(
  domain: string,
  prompt: string,
  history: { role: string; content: string }[]
): Promise<DiscoveryAgentResponse> {
  const systemPrompt = `
You are a requirement discovery agent for Doable, an AI software engineering platform.
Domain: ${domain}

Your job: Ask maximum 3-5 focused questions to fully understand the user's project.
Ask ONE question at a time. Be friendly, concise, non-technical.
If user says "surprise me" → pick sensible defaults immediately.

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
    "ambiguities": []
  },
  "techStack": {
    "frontend": "React + Vite + Tailwind etc",
    "backend": "Node.js + Express etc",
    "database": "PostgreSQL etc",
    "auth": "Clerk etc"
  }
}

Until you have enough information, respond with ONLY this JSON:
{
  "message": "your question here",
  "discoveryComplete": false
}

NEVER explain yourself. NEVER start building. NEVER use tools. ONLY output JSON.
`;

  const messages: LLmMessage[] = [
    { role: "system", content: systemPrompt },
    // Inject history correctly
    ...history.map((m) => ({
      role: (m.role === "USER" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: prompt },
  ];

  const response = await callLLM(messages, []);
  const rawContent = response.choices[0].message.content;

  try {
    return JSON.parse(rawContent) as DiscoveryAgentResponse;
  } catch {
    // LLM returned non-JSON — treat as a follow-up question
    return { message: rawContent, discoveryComplete: false };
  }
}
