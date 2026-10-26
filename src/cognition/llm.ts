import type { LLmMessage } from "@/src/shared/types";
import { callChat } from "@/src/providers";
import type { ChatResult, ToolDefinition } from "@/src/providers";

export type { ChatResult } from "@/src/providers";

/**
 * Cognition-facing model call. Provider selection, timeouts, retries, and
 * usage normalization live behind the provider seam; this function never
 * logs prompts or model output.
 */
export async function callLLM(
  messages: LLmMessage[],
  tools: readonly ToolDefinition[],
  options?: {
    responseFormat?: "text" | "json";
    timeoutMs?: number;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  },
): Promise<ChatResult> {
  return callChat({
    messages,
    tools: tools.length > 0 ? tools : undefined,
    ...options,
  });
}