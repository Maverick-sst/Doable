/**
 * Layered-memory acceptance drill.
 *
 * Seeds a project, runs curation twice (idempotency), applies a user
 * correction (precedence/supersession), deletes a subject (propagation), and
 * verifies retrieval through the Context Engine.
 *
 * Requires local Postgres and an embedding-capable provider. The mock
 * provider serves 768-d embeddings:
 *
 *   bun scripts/mock-provider.ts
 *   DATABASE_URL=postgresql://doable:doable@127.0.0.1:5432/doable \
 *   MODEL_PROVIDER=ollama OLLAMA_BASE_URL=http://127.0.0.1:11435 \
 *   bun scripts/verify-memory.ts
 */
import {
  ExecutionStatus,
  MemoryKind,
  MemoryStatus,
  MessagePhase,
  ProjectStatus,
  Role,
  VerificationStatus,
  WorkflowType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/src/auth";
import { buildContext } from "@/src/hcr/context-engine";
import {
  deleteMemorySubject,
  recordMemoryCorrection,
  runMemoryCuration,
} from "@/src/runtime/memory";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main() {
  const user = await getCurrentUser();
  assert(user, "local user exists");

  await prisma.project.deleteMany({ where: { name: "memory-v2-smoke" } });

  const project = await prisma.project.create({
    data: {
      name: "memory-v2-smoke",
      userId: user.id,
      status: ProjectStatus.DISCOVERY,
    },
  });

  const projectMemory = await prisma.projectMemory.create({
    data: {
      projectId: project.id,
      domain: "FULL_STACK_APPLICATION",
      summary: "A memory smoke app that proves layered curation.",
      requirements: {
        features: ["create items", "list items"],
        userFlows: ["add an item"],
      },
      techStack: { frontend: "React", backend: "Node" },
    },
  });

  const workflow = await prisma.workflow.create({
    data: { projectId: project.id, type: WorkflowType.HCR },
  });
  const execution = await prisma.execution.create({
    data: {
      workflowId: workflow.id,
      status: ExecutionStatus.COMPLETED,
      completionStatus: "COMPLETE",
      attempt: 1,
      finishedAt: new Date(),
    },
  });

  await prisma.verificationReport.createMany({
    data: [
      {
        projectId: project.id,
        status: VerificationStatus.FAILED,
        command: "bun test",
        exitCode: 1,
        output: "old failure",
        createdAt: new Date(Date.now() - 60_000),
      },
      {
        projectId: project.id,
        status: VerificationStatus.PASSED,
        command: "bun test",
        exitCode: 0,
        output: "latest pass",
      },
    ],
  });

  await prisma.message.createMany({
    data: [
      {
        projectId: project.id,
        role: Role.USER,
        phase: MessagePhase.BUILD,
        content: "Always use pnpm for installs",
      },
      {
        projectId: project.id,
        role: Role.USER,
        phase: MessagePhase.BUILD,
        content: "Prefer dark mode in the UI",
      },
    ],
  });

  const first = await runMemoryCuration({
    projectId: project.id,
    userId: user.id,
    trigger: "build",
    executionId: execution.id,
  });
  assert(first.inserted > 0, "first curation inserted entries");
  assert(first.embedded > 0, "new entries were embedded");

  const entries = await prisma.memoryEntry.findMany({
    where: { projectId: project.id },
    select: {
      id: true,
      kind: true,
      subject: true,
      content: true,
      sourceKind: true,
      sourceId: true,
      status: true,
      expiresAt: true,
    },
  });

  const kinds = new Set(entries.map((entry) => entry.kind));
  for (const expected of [
    MemoryKind.SEMANTIC,
    MemoryKind.PROCEDURAL,
    MemoryKind.EPISODIC,
    MemoryKind.PREFERENCE,
  ]) {
    assert(kinds.has(expected), `curation produced ${expected} memory`);
  }
  assert(
    entries.every((entry) => entry.sourceKind.length > 0),
    "every entry carries provenance",
  );
  assert(
    entries.some(
      (entry) =>
        entry.kind === MemoryKind.SEMANTIC &&
        entry.sourceKind === "project-memory" &&
        entry.sourceId === projectMemory.id,
    ),
    "semantic entry points at project memory",
  );
  assert(
    entries.some(
      (entry) =>
        entry.kind === MemoryKind.PROCEDURAL &&
        entry.content.includes("PASSED") &&
        !entry.content.includes("FAILED"),
    ),
    "latest verification status wins",
  );
  assert(
    entries.some(
      (entry) => entry.kind === MemoryKind.EPISODIC && entry.expiresAt !== null,
    ),
    "episodic memory has an expiry",
  );

  const second = await runMemoryCuration({
    projectId: project.id,
    userId: user.id,
    trigger: "build",
    executionId: execution.id,
  });
  assert(second.inserted === 0, "replayed curation inserts nothing");
  assert(second.unchanged > 0, "replayed curation reports no-ops");
  const countAfterReplay = await prisma.memoryEntry.count({
    where: { projectId: project.id },
  });
  assert(
    countAfterReplay === entries.length,
    "idempotent replay does not duplicate rows",
  );

  // A user correction outranks the curated project-memory value.
  const correction = await recordMemoryCorrection({
    projectId: project.id,
    userId: user.id,
    kind: MemoryKind.SEMANTIC,
    subject: "tech-stack:frontend",
    content: "frontend: Svelte",
    sourceId: "manual-correction",
  });
  assert(correction.inserted, "user correction inserted");

  await runMemoryCuration({
    projectId: project.id,
    userId: user.id,
    trigger: "build",
    executionId: execution.id,
  });

  const activeFrontend = await prisma.memoryEntry.findFirst({
    where: {
      projectId: project.id,
      subject: "tech-stack:frontend",
      status: MemoryStatus.ACTIVE,
    },
    select: { content: true, sourceKind: true },
  });
  assert(
    activeFrontend?.content === "frontend: Svelte" &&
      activeFrontend.sourceKind === "user-correction",
    "user correction survives re-curation",
  );

  // Retrieval sees layered memory and provenance.
  const context = await buildContext(
    {
      projectId: project.id,
      agentType: "ARCHITECT",
      task: "review",
      prompt: "review",
      policy: {
        consumedArtifactTypes: [],
        includeFileTree: false,
        includeVectorSearch: false,
        includeMessageHistory: false,
        includeMemory: true,
      },
      budget: { limitTokens: 4_000 },
    },
    {
      toolHistory: [],
      currentContext: { currentTask: "review", iteration: 0, scratchpad: [] },
      promptEmbedding: Array.from({ length: 768 }, () => 0.01),
      systemPrompt: "SYS",
      outputMode: "structured_json",
    },
  );
  const memorySources = context.sources.filter(
    (source) => source.kind === "memory" && source.inclusion === "included",
  );
  assert(memorySources.length > 0, "context includes layered memory");
  assert(
    context.memories?.some((entry) => entry.subject === "tech-stack:frontend"),
    "retrieval returns the corrected frontend memory",
  );

  // Deletion propagates to every version and clears derived vectors.
  const deleted = await deleteMemorySubject({
    projectId: project.id,
    subject: "tech-stack:frontend",
    reason: "user requested deletion",
  });
  assert(deleted >= 2, "deletion covers the active and superseded rows");

  const afterDelete = await buildContext(
    {
      projectId: project.id,
      agentType: "ARCHITECT",
      task: "review",
      prompt: "review",
      policy: {
        consumedArtifactTypes: [],
        includeFileTree: false,
        includeVectorSearch: false,
        includeMessageHistory: false,
        includeMemory: true,
      },
      budget: { limitTokens: 4_000 },
    },
    {
      toolHistory: [],
      currentContext: { currentTask: "review", iteration: 0, scratchpad: [] },
      promptEmbedding: Array.from({ length: 768 }, () => 0.01),
      systemPrompt: "SYS",
      outputMode: "structured_json",
    },
  );
  assert(
    !afterDelete.memories?.some(
      (entry) => entry.subject === "tech-stack:frontend",
    ),
    "deleted memory is not retrieved",
  );

  await prisma.project.delete({ where: { id: project.id } });

  console.log("Memory V2 smoke: PASS");
  console.log(
    JSON.stringify(
      {
        first,
        replay: second,
        entries: entries.length,
        kinds: [...kinds].sort(),
        corrected: activeFrontend?.content,
        deleted,
        retrieved: memorySources.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(
      "Memory V2 smoke: FAIL",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
