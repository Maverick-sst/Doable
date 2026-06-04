import { LLmMessage } from "@/src/shared/types";

export async function callLLM(messages: LLmMessage[], tools: typeof import("@/lib/tools").tools ) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.MODEL,
      messages,
      tools,
      tool_choice: "auto"
    })
  })
  return response.json()
}
