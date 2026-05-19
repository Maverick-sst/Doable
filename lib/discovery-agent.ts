import { callLLM } from "./llm";
import { LLmMessage } from "./types";

export async function callDiscoveryAgent(domain: string, prompt: string, history: {role: string, content: string}[]) {
  const systemPrompt = `
       You are a requirement discovery agent for Doable, an AI software engineering platform.
       Domain: ${domain}
       USER_PROMPT: ${prompt}
       Your job: Ask maximum 3-5 focused questions to understand the user's project.
       Ask ONE question at a time. Be friendly, concise, non-technical.
       If user says "surprise me" → pick sensible defaults immediately.

      When you have enough information respond with ONLY this JSON:
      {
        "message": "Great! I have everything I need...",
        "discoveryComplete": true,
        "requirements": { "description": "...", "features": [] },
        "techStack": { "frontend": "...", "backend": "...", "database": "..." }
      }

      Until complete respond with ONLY this JSON:
      {
        "message": "your question here",
        "discoveryComplete": false
      }

      Never explain yourself. Never start building. Never use tools.
`;

  const messages: LLmMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt }, // { role: "user", content: surpriseMe ? "surprise me" : message },
    ...history.map(m => ({
      role: m.role.toLowerCase() as "user" || "assistant",
      content: m.content
    })),
  ];

  const response = await callLLM(messages, []);
  return JSON.parse(response.choices[0].message.content);
}