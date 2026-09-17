import { LLmMessage } from "@/src/shared/types";

export async function callLLM(messages: LLmMessage[], tools: typeof import("@/lib/tools").tools) {
   console.log("----------------Actual LLM call ----------------");

   const hasTools = Array.isArray(tools) && tools.length > 0;
   const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": "Doable",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.MODEL,
      messages,
      ...(hasTools ? { tools, tool_choice: "auto" } : {}),
    })
  });

  console.log("------------------deserealizing response------------");
  let data: any;
  try{
    data = await response.json();
}catch(error){
  throw new Error(`error: ${error}`);
}
  
  if (!response.ok || data.error) {
    throw new Error(`LLM API Error (${response.status}): ${JSON.stringify(data.error || data)}`);
  }
  
  return data;
}
