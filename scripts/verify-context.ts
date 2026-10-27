/**
 * Context Engine V2 acceptance drill.
 *
 * Seeds a project with a long conversation, curated memory, a stale
 * verification report, and a workspace file, then proves:
 *
 *   - compaction fits the budget and reports what it dropped;
 *   - intent, unresolved questions, and pending approvals survive;
 *   - missing/stale sources are visible in the manifest;
 *   - the same durable state yields the same fingerprint.
 *
 * Requires the local Postgres from docker-compose.local.yml.
 *
 *   DATABASE_URL=postgresql://doable:doable@127.0.0.1:5432/doable \
 *   bun scripts/verify-context.ts
 */
import {
  MessagePhase,
  ProjectStatus,
  Role,
  VerificationStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/src/auth";
import { buildContext } from "@/src/hcr/context-engine";
import type { ContextPolicy } from "@/src/hcr/context-engine";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const BUDGET_TOKENS = 1000;

async function main() {
  const user = await getCurrentUser();
  assert(user, "local user exists");

  await prisma.project.deleteMany({ where: { name: "context-v2-smoke" } });

  const project = await prisma.project.create({
    data: {
      name: "context-v2-smoke",
      userId: user.id,
      status: ProjectStatus.DISCOVERY,
    },
  });

  const base = Date.now() - 60_000;
  const conversation = [
    ["USER", "Build the context smoke app"],
    ["ASSISTANT", "Understood. I will scaffold it."],
    ["USER", "Can it support tags?"],
    ["ASSISTANT", "Yes, tags are in scope."],
    ["USER", "Please approve the plan"],
    ...Array.from({ length: 120 }, (_, index) => [
      index % 2 === 0 ? "USER" : "ASSISTANT",
      `Follow-up message ${index} with enough text to consume context budget.`,
    ]),
  ] as Array<[string, string]>;

  const created: Array<{ id: string }> = [];
  for (let index = 0; index < conversation.length; index++) {
    const [role, content] = conversation[index];
    created.push(
      await prisma.message.create({
        data: {
          projectId: project.id,
          role: role === "USER" ? Role.USER : Role.ASSISTANT,
          content,
          phase: MessagePhase.BUILD,
          createdAt: new Date(base + index * 1_000),
        },
      }),
    );
  }

  await prisma.projectMemory.create({
    data: {
      projectId: project.id,
      domain: "FULL_STACK_APPLICATION",
      requirements: { summary: "Context smoke requirements" },
      techStack: { frontend: "React" },
      summary: "A small app used to prove context compaction.",
    },
  });

  const file = await prisma.file.create({
    data: {
      projectId: project.id,
      path: "src/index.ts",
      content: "export const version = 1;\n",
      size: 28,
      mimeType: "text/typescript",
      embeddingStatus: "EMBEDDING_PENDING",
    },
  });

  const report = await prisma.verificationReport.create({
    data: {
      projectId: project.id,
      status: VerificationStatus.PASSED,
      command: "doable-structure-check",
      exitCode: 0,
      durationMs: 12,
      output: "structure ok",
      revision: "1 file",
    },
  });

  // Change the workspace after verification so the report is stale.
  await prisma.file.update({
    where: { id: file.id },
    data: { content: "export const version = 2;\n" },
  });

  const policy: ContextPolicy = {
    consumedArtifactTypes: [],
    includeFileTree: false,
    includeVectorSearch: false,
    includeMessageHistory: true,
    includeVerification: true,
    includeMemory: true,
    maxHistoryMessages: 150,
  };

  const request = {
    projectId: project.id,
    agentType: "ARCHITECT" as const,
    task: "review the implementation",
    prompt: "review the implementation",
    policy,
    budget: { limitTokens: BUDGET_TOKENS },
  };
  const callerInputs = {
    toolHistory: [],
    currentContext: { currentTask: "review", iteration: 0, scratchpad: [] },
    promptEmbedding: [],
    systemPrompt: "SYS",
    outputMode: "structured_json" as const,
  };

  const result = await buildContext(request, callerInputs);
  const blob = (result.messages[1] as { content: string }).content;

  assert(result.facts.intent?.content === "Build the context smoke app", "intent preserved");
  assert(
    result.facts.unresolvedQuestions.some((fact) => fact.content.includes("tags")),
    "unresolved question preserved",
  );
  assert(
    result.facts.pendingApprovals.some((fact) => fact.content.includes("approve")),
    "pending approval preserved",
  );
  assert(result.budget.compacted, "budget compaction ran");
  assert(result.budget.usedTokens <= BUDGET_TOKENS, "used tokens stay within budget");
  assert(result.budget.omitted.message ?? 0 > 0, "omitted messages counted");
  assert(blob.includes("=== CONVERSATION FACTS ==="), "facts section rendered");
  assert(blob.includes("=== CONTEXT NOTES ==="), "notes section rendered");
  assert(blob.includes("Build the context smoke app"), "intent rendered in prompt");
  assert(
    result.sources.some(
      (source) =>
        source.kind === "memory" &&
        source.inclusion === "included" &&
        source.status === "available",
    ),
    "project memory included with provenance",
  );
  assert(
    result.sources.some(
      (source) =>
        source.kind === "verification" &&
        source.id === report.id &&
        source.status === "stale",
    ),
    "stale verification visible",
  );
  assert(
    result.sources.some(
      (source) =>
        source.kind === "message" &&
        source.priority === "required" &&
        source.id === created[0].id,
    ),
    "intent message has required provenance",
  );

  const repeat = await buildContext(request, callerInputs);
  assert(
    repeat.fingerprint === result.fingerprint,
    "same durable state yields the same fingerprint",
  );

  const tighter = await buildContext(
    { ...request, budget: { limitTokens: 1500 } },
    callerInputs,
  );
  assert(
    tighter.fingerprint !== result.fingerprint,
    "a different budget yields a different fingerprint",
  );

  await prisma.project.delete({ where: { id: project.id } });

  console.log("Context V2 smoke: PASS");
  console.log(
    JSON.stringify(
      {
        fingerprint: result.fingerprint,
        budget: result.budget,
        facts: {
          intent: result.facts.intent?.messageId ?? null,
          unresolved: result.facts.unresolvedQuestions.length,
          approvals: result.facts.pendingApprovals.length,
        },
        sources: {
          total: result.sources.length,
          included: result.sources.filter((source) => source.inclusion === "included").length,
          missing: result.sources.filter((source) => source.status === "missing").length,
          stale: result.sources.filter((source) => source.status === "stale").length,
        },
        messages: result.messages.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(
      "Context V2 smoke: FAIL",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
