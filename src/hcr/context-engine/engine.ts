import { assembleContext } from "./assembler";
import { extractConversationFacts } from "./facts";
import { retrieveArtifacts } from "./retrievers/artifacts";
import { retrieveFailures } from "./retrievers/failures";
import { retrieveFiles } from "./retrievers/files";
import { retrieveProjectMemory } from "./retrievers/memory";
import { retrieveMessageHistory, DEFAULT_HISTORY_LIMIT } from "./retrievers/message-history";
import { retrieveRelevantFiles } from "./retrievers/relevant-files";
import { retrieveVerificationReports } from "./retrievers/verification";
import {
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  fingerprintContext,
  selectContext,
} from "./selection";
import type {
  CallerContextInputs,
  ContextPolicy,
  ContextRequest,
  ContextResult,
} from "./types";

/** Keeps a nonsense budget from producing an unusable context. */
const MIN_CONTEXT_TOKENS = 1_000;

function resolveLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_CONTEXT_TOKEN_BUDGET;
  }
  return Math.max(MIN_CONTEXT_TOKENS, Math.floor(requested));
}

async function retrieveOptionalSources(
  request: ContextRequest,
): Promise<{
  verification: Awaited<ReturnType<typeof retrieveVerificationReports>>;
  failures: Awaited<ReturnType<typeof retrieveFailures>>;
  memory: Awaited<ReturnType<typeof retrieveProjectMemory>>;
}> {
  const policy = request.policy;
  const [verification, failures, memory] = await Promise.all([
    policy.includeVerification
      ? retrieveVerificationReports(request.projectId)
      : Promise.resolve([]),
    policy.includeFailures
      ? retrieveFailures(request.projectId)
      : Promise.resolve([]),
    policy.includeMemory
      ? retrieveProjectMemory(request.projectId)
      : Promise.resolve(null),
  ]);
  return { verification, failures, memory };
}

/**
 * Single public entry point of the Context Engine.
 *
 * V2 adds typed provenance, deterministic ranking/dedup, a token budget with
 * explicit compaction, pinned conversation facts, and a reproducibility
 * fingerprint. Retrieval remains policy-gated: an absent flag performs no
 * query, so existing node contracts keep their exact context shape.
 */
export async function buildContext(
  request: ContextRequest,
  callerInputs: CallerContextInputs,
): Promise<ContextResult> {
  const policy: ContextPolicy = request.policy;
  const task = request.task || request.prompt;

  const [artifacts, files, relevantFiles, messages, optional] =
    await Promise.all([
      policy.consumedArtifactTypes.length > 0
        ? retrieveArtifacts(request.projectId, policy.consumedArtifactTypes)
        : Promise.resolve({ available: [], missing: [] }),
      policy.includeFileTree
        ? retrieveFiles(request.projectId)
        : Promise.resolve([]),
      policy.includeVectorSearch && callerInputs.promptEmbedding.length > 0
        ? retrieveRelevantFiles(
            request.projectId,
            callerInputs.promptEmbedding,
          )
        : Promise.resolve([]),
      policy.includeMessageHistory
        ? retrieveMessageHistory(
            request.projectId,
            policy.maxHistoryMessages ?? DEFAULT_HISTORY_LIMIT,
          )
        : Promise.resolve([]),
      retrieveOptionalSources(request),
    ]);

  const facts = extractConversationFacts(messages);
  const limitTokens = resolveLimit(request.budget?.limitTokens);

  const selection = selectContext({
    limitTokens,
    systemPrompt: callerInputs.systemPrompt,
    prompt: request.prompt,
    task,
    policy,
    artifacts: artifacts.available,
    missingArtifactTypes: artifacts.missing,
    facts,
    files,
    relevantFiles,
    verification: optional.verification,
    failures: optional.failures,
    memory: optional.memory,
    messages,
    toolHistory: callerInputs.toolHistory,
    scratchpad: callerInputs.currentContext.scratchpad,
  });

  const messagesOut = assembleContext({
    systemPrompt: callerInputs.systemPrompt,
    prompt: request.prompt,
    task,
    policy,
    outputMode: callerInputs.outputMode,
    artifacts: selection.artifacts,
    files: selection.files,
    relevantFiles: selection.relevantFiles,
    messages: selection.messages,
    toolHistory: selection.toolHistory,
    currentContext: callerInputs.currentContext,
    promptEmbedding: callerInputs.promptEmbedding,
    facts,
    notes: selection.notes,
  });

  return {
    messages: messagesOut,
    sources: selection.sources,
    facts,
    budget: selection.budget,
    fingerprint: fingerprintContext({
      task,
      prompt: request.prompt,
      policy,
      limitTokens,
      facts,
      sources: selection.sources,
    }),
  };
}
