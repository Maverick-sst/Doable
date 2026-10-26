import { callEmbeddings } from "@/src/providers";

/**
 * Embedding compatibility seam. The provider module owns model selection,
 * endpoint differences, and timeouts.
 */
export async function getEmbeddings(text: string): Promise<number[]> {
  return callEmbeddings({ input: text });
}