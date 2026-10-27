import type { ContextFact, ContextFacts } from "./types";

/** Message shape facts extraction needs; the retriever supplies it. */
export interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  createdAt: Date | string;
}

const MAX_UNRESOLVED_QUESTIONS = 3;
const MAX_PENDING_APPROVALS = 3;
const QUESTION_MARK = /\?/;
const APPROVAL_WORDS = /\b(approve|approved|approval|approvals|sign[- ]?off)\b/i;

function toFact(message: ConversationMessage): ContextFact {
  return {
    messageId: message.id,
    content: message.content,
    createdAt:
      message.createdAt instanceof Date
        ? message.createdAt.toISOString()
        : message.createdAt,
  };
}

function isUser(message: ConversationMessage): boolean {
  return message.role.toUpperCase() === "USER";
}

/**
 * Extracts the facts compaction must never lose. The rules are deliberately
 * simple and deterministic:
 *
 * - intent: the earliest user message (the original request);
 * - unresolved questions: the latest user messages containing `?`;
 * - pending approvals: the latest user messages mentioning approval.
 *
 * Returns facts in chronological order so the prompt reads naturally.
 */
export function extractConversationFacts(
  messages: ConversationMessage[],
): ContextFacts {
  const userMessages = messages.filter(
    (message) => isUser(message) && message.content.trim().length > 0,
  );

  const intentMessage = userMessages[0] ?? null;
  const intent = intentMessage ? toFact(intentMessage) : null;

  const others = userMessages.filter(
    (message) => message.id !== intentMessage?.id,
  );

  const unresolved = others
    .filter((message) => QUESTION_MARK.test(message.content))
    .slice(-MAX_UNRESOLVED_QUESTIONS)
    .map(toFact);

  const approvals = others
    .filter((message) => APPROVAL_WORDS.test(message.content))
    .slice(-MAX_PENDING_APPROVALS)
    .map(toFact);

  return {
    intent,
    unresolvedQuestions: unresolved,
    pendingApprovals: approvals,
  };
}

/** Message ids pinned as facts; excluded from the optional history window. */
export function pinnedFactMessageIds(facts: ContextFacts): Set<string> {
  const ids = new Set<string>();
  if (facts.intent) ids.add(facts.intent.messageId);
  for (const fact of facts.unresolvedQuestions) ids.add(fact.messageId);
  for (const fact of facts.pendingApprovals) ids.add(fact.messageId);
  return ids;
}
