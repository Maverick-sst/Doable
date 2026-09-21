import { assembleContext } from "./assembler";
import { retrieveArtifacts } from "./retrievers/artifacts";
import { retrieveFiles } from "./retrievers/files";
import { retrieveMessageHistory } from "./retrievers/message-history";
import { retrieveRelevantFiles } from "./retrievers/relevant-files";
import type {
  CallerContextInputs,
  ContextRequest,
  ContextResult,
} from "./types";
import type { AssembleContextInput } from "./assembler";

/**
 * Internal resolution between retrieval and assembly (§7). Not a public API:
 * it carries exactly what the current assembler consumes, nothing more.
 */
interface ResolvedContext {
  assembled: AssembleContextInput;
}

async function resolveContext(
  request: ContextRequest,
  callerInputs: CallerContextInputs,
): Promise<ResolvedContext> {
  const artifacts =
    request.policy.consumedArtifactTypes.length > 0
      ? await retrieveArtifacts(
          request.projectId,
          request.policy.consumedArtifactTypes,
        )
      : [];

  const files = request.policy.includeFileTree
    ? await retrieveFiles(request.projectId)
    : [];

  const relevantFiles = request.policy.includeVectorSearch
    ? await retrieveRelevantFiles(
        request.projectId,
        callerInputs.promptEmbedding,
      )
    : [];

  const messages = request.policy.includeMessageHistory
    ? await retrieveMessageHistory(request.projectId)
    : [];

  return {
    assembled: {
      systemPrompt: callerInputs.systemPrompt,
      prompt: request.prompt,
      task: request.task || request.prompt,
      policy: request.policy,
      outputMode: callerInputs.outputMode,
      artifacts,
      files,
      relevantFiles,
      messages,
      toolHistory: callerInputs.toolHistory,
      currentContext: callerInputs.currentContext,
      promptEmbedding: callerInputs.promptEmbedding,
    },
  };
}

/**
 * Single public entry point of the Context Engine boundary.
 *
 * Owns all existing context-source retrieval (artifacts, project files,
 * relevant files, message history) plus assembly, gated by the request
 * policy exactly as the runtime has always behaved. `agentType` is carried
 * for tracing and future policy selection; it does not alter assembly
 * today. Embedding generation stays with the caller (§6).
 */
export async function buildContext(
  request: ContextRequest,
  callerInputs: CallerContextInputs,
): Promise<ContextResult> {
  const resolved = await resolveContext(request, callerInputs);
  return { messages: assembleContext(resolved.assembled) };
}
