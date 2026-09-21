import { assembleContext } from "./assembler";
import { retrieveArtifacts } from "./retrievers/artifacts";
import { retrieveRelevantFiles } from "./retrievers/relevant-files";
import type {
  CallerContextInputs,
  ContextRequest,
  ContextResult,
} from "./types";

/**
 * Single public entry point of the Context Engine boundary.
 *
 * Runtime callers invoke this instead of importing individual retrievers or
 * the assembler. Policy-gated retrieval first (artifacts, relevant files),
 * then pure assembly — the same order, flags, budgets, and output shape the
 * runtime has always produced. `agentType` is carried for tracing and future
 * policy selection; it does not alter assembly today.
 */
export async function buildContext(
  request: ContextRequest,
  callerInputs: CallerContextInputs,
): Promise<ContextResult> {
  const artifacts =
    request.policy.consumedArtifactTypes.length > 0
      ? await retrieveArtifacts(
          request.projectId,
          request.policy.consumedArtifactTypes,
        )
      : [];

  const relevantFiles = request.policy.includeVectorSearch
    ? await retrieveRelevantFiles(
        request.projectId,
        callerInputs.promptEmbedding,
      )
    : [];

  return {
    messages: assembleContext({
      systemPrompt: callerInputs.systemPrompt,
      prompt: request.prompt,
      policy: request.policy,
      outputMode: callerInputs.outputMode,
      artifacts,
      relevantFiles,
      files: callerInputs.files,
      messages: callerInputs.messages,
      toolHistory: callerInputs.toolHistory,
      currentContext: callerInputs.currentContext,
      promptEmbedding: callerInputs.promptEmbedding,
    }),
  };
}
