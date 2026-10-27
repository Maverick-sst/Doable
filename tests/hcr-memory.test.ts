import { describe, expect, test } from "bun:test";
import { MemoryKind, MemoryStatus } from "@prisma/client";
import {
  decideMemoryMerge,
  memoryContentHash,
  memoryContentKey,
  memoryExpiry,
  normalizeMemoryContent,
} from "@/src/runtime/memory";
import { assembleContext } from "@/src/hcr/context-engine/assembler";
import type { AssembleContextInput } from "@/src/hcr/context-engine/assembler";
import { selectContext } from "@/src/hcr/context-engine/selection";
import type { SelectionInput } from "@/src/hcr/context-engine/selection";
import type { ContextPolicy, MemoryContext } from "@/src/hcr/context-engine/types";

// Layered-memory policy and context integration. No DB: the curation drill
// (scripts/verify-memory.ts) covers persistence, embeddings, and retrieval.

const POLICY: ContextPolicy = {
  consumedArtifactTypes: [],
  includeFileTree: false,
  includeVectorSearch: false,
  includeMessageHistory: false,
};

function memory(partial: Partial<MemoryContext> = {}): MemoryContext {
  return {
    id: "mem-1",
    kind: MemoryKind.SEMANTIC,
    subject: "summary",
    content: "A context smoke app.",
    confidence: 0.9,
    updatedAt: "2026-01-01T00:00:00.000Z",
    sourceKind: "project-memory",
    sourceId: "pm-1",
    ...partial,
  };
}

function baseSelection(): SelectionInput {
  return {
    limitTokens: 60_000,
    systemPrompt: "SYS",
    prompt: "p",
    task: "t",
    policy: POLICY,
    artifacts: [],
    missingArtifactTypes: [],
    facts: { intent: null, unresolvedQuestions: [], pendingApprovals: [] },
    files: [],
    relevantFiles: [],
    verification: [],
    failures: [],
    memories: [],
    messages: [],
    toolHistory: [],
    scratchpad: [],
  };
}

describe("Memory content identity", () => {
  test("normalization is stable across whitespace changes", () => {
    expect(normalizeMemoryContent("  use   pnpm\r\nAlways ")).toBe(
      "use pnpm\nAlways",
    );
    expect(memoryContentHash("use  pnpm")).toBe(memoryContentHash("use pnpm"));
  });

  test("content key separates scope, owner, kind, subject, and content", () => {
    const base = {
      scope: "PROJECT",
      projectId: "p1",
      userId: null,
      kind: MemoryKind.SEMANTIC,
      subject: "summary",
      contentHash: memoryContentHash("a"),
    };
    expect(memoryContentKey(base)).not.toBe(
      memoryContentKey({ ...base, subject: "tech-stack" }),
    );
    expect(memoryContentKey(base)).not.toBe(
      memoryContentKey({ ...base, kind: MemoryKind.EPISODIC }),
    );
    expect(memoryContentKey(base)).not.toBe(
      memoryContentKey({ ...base, contentHash: memoryContentHash("b") }),
    );
  });

  test("only episodic memory expires", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiry = memoryExpiry(MemoryKind.EPISODIC, now, 30);
    expect(expiry?.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(memoryExpiry(MemoryKind.SEMANTIC, now, 30)).toBeNull();
  });
});

describe("Memory conflict policy", () => {
  const curated = {
    contentHash: memoryContentHash("React"),
    sourceKind: "project-memory",
    status: MemoryStatus.ACTIVE,
  };

  test("identical content is a no-op", () => {
    expect(
      decideMemoryMerge(curated, {
        contentHash: curated.contentHash,
        sourceKind: "project-memory",
      }),
    ).toBe("noop");
  });

  test("newer curated content supersedes the active entry", () => {
    expect(
      decideMemoryMerge(curated, {
        contentHash: memoryContentHash("Svelte"),
        sourceKind: "project-memory",
      }),
    ).toBe("supersede");
  });

  test("user corrections outrank curated memory", () => {
    const correction = {
      contentHash: memoryContentHash("Svelte"),
      sourceKind: "user-correction",
      status: MemoryStatus.ACTIVE,
    };
    expect(
      decideMemoryMerge(correction, {
        contentHash: memoryContentHash("React"),
        sourceKind: "project-memory",
      }),
    ).toBe("skip");
    expect(
      decideMemoryMerge(correction, {
        contentHash: memoryContentHash("Vue"),
        sourceKind: "user-correction",
      }),
    ).toBe("supersede");
  });

  test("inactive history does not block a new entry", () => {
    expect(
      decideMemoryMerge(
        { ...curated, status: MemoryStatus.SUPERSEDED },
        { contentHash: memoryContentHash("Svelte"), sourceKind: "project-memory" },
      ),
    ).toBe("insert");
  });
});

describe("Memory in context", () => {
  function baseAssembly(): AssembleContextInput {
    return {
      systemPrompt: "SYS",
      prompt: "do the thing",
      task: "do the thing",
      policy: { ...POLICY },
      outputMode: "structured_json",
      artifacts: [],
      files: [],
      relevantFiles: [],
      messages: [],
      toolHistory: [],
      currentContext: { currentTask: "", iteration: 0, scratchpad: [] },
      promptEmbedding: [],
      memories: [],
    };
  }

  test("renders layered memories with kind and subject", () => {
    const input = baseAssembly();
    input.memories = [
      memory(),
      memory({
        id: "mem-2",
        kind: MemoryKind.PROCEDURAL,
        subject: "verification:test",
        content: "test: PASSED (exit 0)",
      }),
    ];
    const blob = (assembleContext(input)[1] as { content: string }).content;
    expect(blob.includes("=== PROJECT MEMORY ===")).toBe(true);
    expect(blob.includes("[SEMANTIC] summary: A context smoke app.")).toBe(true);
    expect(blob.includes("[PROCEDURAL] verification:test")).toBe(true);
  });

  test("no memories leaves the prompt shape unchanged", () => {
    const withEmpty = assembleContext(baseAssembly());
    const without = assembleContext({ ...baseAssembly(), memories: undefined });
    expect(withEmpty).toEqual(without);
    expect(
      (withEmpty[1] as { content: string }).content.includes("PROJECT MEMORY"),
    ).toBe(false);
  });

  test("budget drops lower-ranked memories with provenance", () => {
    const input = baseSelection();
    input.limitTokens = 50;
    input.memories = [
      memory({ id: "small", content: "x".repeat(40) }),
      memory({ id: "large", content: "y".repeat(200) }),
    ];

    const selection = selectContext(input);
    expect(selection.memories.map((entry) => entry.id)).toEqual(["small"]);
    expect(
      selection.sources.find(
        (source) => source.id === "large" && source.reason === "budget",
      )?.inclusion,
    ).toBe("dropped");
    expect(selection.budget.omitted.memory).toBe(1);
    expect(
      selection.notes.some((note) => note.includes("memory source(s) omitted")),
    ).toBe(true);
  });
});
