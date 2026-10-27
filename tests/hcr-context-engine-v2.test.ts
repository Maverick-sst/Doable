import { describe, expect, test } from "bun:test";
import { ArtifactType } from "@prisma/client";
import { assembleContext } from "@/src/hcr/context-engine/assembler";
import type { AssembleContextInput } from "@/src/hcr/context-engine/assembler";
import {
  extractConversationFacts,
  pinnedFactMessageIds,
} from "@/src/hcr/context-engine/facts";
import {
  estimateTokens,
  fingerprintContext,
  selectContext,
} from "@/src/hcr/context-engine/selection";
import type { SelectionInput } from "@/src/hcr/context-engine/selection";
import { buildContext } from "@/src/hcr/context-engine/engine";
import type {
  CallerContextInputs,
  ContextPolicy,
  HistoryMessage,
} from "@/src/hcr/context-engine/types";

// Context Engine V2 suite: pure selection/compaction/facts plus the entry
// point. No DB — DB-backed retrievers are exercised by scripts/verify-context.

const POLICY: ContextPolicy = {
  consumedArtifactTypes: [],
  includeFileTree: false,
  includeVectorSearch: false,
  includeMessageHistory: false,
};

function message(
  id: string,
  role: "USER" | "ASSISTANT",
  content: string,
  createdAt = "2026-01-01T00:00:00.000Z",
): HistoryMessage {
  return { id, role, content, createdAt };
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
    facts: {
      intent: null,
      unresolvedQuestions: [],
      pendingApprovals: [],
    },
    files: [],
    relevantFiles: [],
    verification: [],
    failures: [],
    memory: null,
    messages: [],
    toolHistory: [],
    scratchpad: [],
  };
}

describe("Conversation facts", () => {
  test("intent is the earliest user message; questions and approvals are pinned", () => {
    const facts = extractConversationFacts([
      message("m1", "USER", "Build a todo app"),
      message("m2", "ASSISTANT", "Sure"),
      message("m3", "USER", "Can it support tags?"),
      message("m4", "USER", "Please approve the plan"),
      message("m5", "USER", "What about auth?"),
    ]);

    expect(facts.intent?.messageId).toBe("m1");
    expect(facts.unresolvedQuestions.map((f) => f.messageId)).toEqual([
      "m3",
      "m5",
    ]);
    expect(facts.pendingApprovals.map((f) => f.messageId)).toEqual(["m4"]);
    expect([...pinnedFactMessageIds(facts)].sort()).toEqual([
      "m1",
      "m3",
      "m4",
      "m5",
    ]);
  });

  test("assistant messages never become facts", () => {
    const facts = extractConversationFacts([
      message("a1", "ASSISTANT", "Should I approve this?"),
    ]);
    expect(facts.intent).toBeNull();
    expect(facts.unresolvedQuestions).toEqual([]);
    expect(facts.pendingApprovals).toEqual([]);
  });
});

describe("Budgeting and compaction", () => {
  test("keeps the newest messages, preserves intent, and reports omissions", () => {
    const input = baseSelection();
    input.limitTokens = 150;
    const intent = message("m0", "USER", "x".repeat(40));
    const others = Array.from({ length: 20 }, (_, index) =>
      message(`m${index + 1}`, index % 2 === 0 ? "USER" : "ASSISTANT", "y".repeat(200)),
    );
    input.messages = [intent, ...others];
    input.facts = extractConversationFacts(input.messages);

    const selection = selectContext(input);

    expect(selection.facts.intent?.messageId).toBe("m0");
    expect(selection.messages.map((m) => m.id)).toEqual(["m19", "m20"]);
    expect(selection.budget.compacted).toBe(true);
    expect(selection.budget.overflow).toBe(false);
    expect(selection.budget.omitted.message).toBe(18);
    expect(
      selection.notes.some((note) => note.includes("18 earlier message(s)")),
    ).toBe(true);
    // Intent is required provenance even though its message was not repeated
    // in the optional history window.
    expect(
      selection.sources.some(
        (source) =>
          source.id === "m0" &&
          source.priority === "required" &&
          source.inclusion === "included",
      ),
    ).toBe(true);
  });

  test("required sources overflow honestly instead of being truncated", () => {
    const input = baseSelection();
    input.limitTokens = 50;
    input.artifacts = [
      {
        id: "art-1",
        type: ArtifactType.DISCOVERY_REQUIREMENT,
        version: 1,
        content: { spec: "x".repeat(4_000) },
      },
    ];

    const selection = selectContext(input);
    expect(selection.artifacts).toHaveLength(1);
    expect(selection.budget.overflow).toBe(true);
    expect(selection.budget.usedTokens).toBeGreaterThan(50);
    expect(
      selection.notes.some((note) => note.includes("exceeds the 50-token budget")),
    ).toBe(true);
  });

  test("compacts tool history and prunes orphan tool results", () => {
    const input = baseSelection();
    input.limitTokens = 31;
    input.toolHistory = [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "cA", type: "function", function: { name: "x" } }],
      },
      { role: "tool", content: "tool-a", tool_call_id: "cA" },
      { role: "tool", content: "tool-b", tool_call_id: "cB" },
    ];

    const selection = selectContext(input);
    expect(selection.toolHistory).toEqual([]);
    expect(selection.budget.omitted["tool-history"]).toBe(3);
    expect(
      selection.notes.some((note) => note.includes("earlier tool step(s)")),
    ).toBe(true);
  });

  test("deduplicates relevant files and keeps provenance", () => {
    const input = baseSelection();
    input.relevantFiles = [
      { id: "f1", path: "src/a.ts", snippet: "first" },
      { id: "f2", path: "src/a.ts", snippet: "second" },
    ];

    const selection = selectContext(input);
    expect(selection.relevantFiles).toHaveLength(1);
    const duplicate = selection.sources.find(
      (source) => source.id === "f2" && source.reason === "duplicate",
    );
    expect(duplicate?.inclusion).toBe("dropped");
  });

  test("surfaces missing and stale sources", () => {
    const input = baseSelection();
    input.missingArtifactTypes = [ArtifactType.ARCHITECTURE_SPEC];
    input.verification = [
      {
        id: "v1",
        status: "PASSED",
        command: "test",
        exitCode: 0,
        durationMs: 10,
        outputSnippet: "ok",
        revision: "r1",
        createdAt: "2026-01-01T00:00:00.000Z",
        stale: true,
      },
    ];

    const selection = selectContext(input);
    expect(
      selection.sources.find(
        (source) => source.kind === "artifact" && source.status === "missing",
      )?.label,
    ).toBe("ARCHITECTURE_SPEC");
    expect(
      selection.sources.find((source) => source.kind === "verification")?.status,
    ).toBe("stale");
    expect(
      selection.notes.some((note) => note.includes("Missing context source")),
    ).toBe(true);
    expect(
      selection.notes.some((note) => note.includes("marked stale")),
    ).toBe(true);
  });

  test("same durable state yields the same fingerprint", () => {
    const input = baseSelection();
    input.messages = [
      message("m1", "USER", "Build a todo app"),
      message("m2", "ASSISTANT", "ok"),
    ];
    input.facts = extractConversationFacts(input.messages);
    const first = selectContext(input);
    const second = selectContext(input);

    const print = (sources: typeof first.sources, limit: number) =>
      fingerprintContext({
        task: input.task,
        prompt: input.prompt,
        policy: input.policy,
        limitTokens: limit,
        facts: input.facts,
        sources,
      });

    expect(print(first.sources, 60_000)).toBe(print(second.sources, 60_000));
    expect(print(first.sources, 60_000)).not.toBe(
      print(first.sources, 50_000),
    );
  });
});

describe("Assembler V2 sections", () => {
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
    };
  }

  test("renders pinned facts and compaction notes", () => {
    const input = baseAssembly();
    input.facts = {
      intent: {
        messageId: "m1",
        content: "Build a todo app",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      unresolvedQuestions: [],
      pendingApprovals: [
        {
          messageId: "m4",
          content: "Please approve the plan",
          createdAt: "2026-01-01T00:00:03.000Z",
        },
      ],
    };
    input.notes = ["5 earlier message(s) omitted."];

    const blob = (assembleContext(input)[1] as { content: string }).content;
    expect(blob.includes("=== CONVERSATION FACTS ===")).toBe(true);
    expect(blob.includes("Build a todo app")).toBe(true);
    expect(blob.includes("Pending approvals")).toBe(true);
    expect(blob.includes("=== CONTEXT NOTES ===")).toBe(true);
    expect(blob.includes("5 earlier message(s) omitted.")).toBe(true);
  });

  test("no facts or notes leaves the original prompt shape untouched", () => {
    const withEmpty = assembleContext(baseAssembly());
    const withoutFields = assembleContext({
      ...baseAssembly(),
      facts: undefined,
      notes: undefined,
    });
    expect(withEmpty).toEqual(withoutFields);
    expect(
      (withEmpty[1] as { content: string }).content.includes(
        "CONVERSATION FACTS",
      ),
    ).toBe(false);
  });

  test("caps the file tree and reports the remainder", () => {
    const input = baseAssembly();
    input.outputMode = "tool_calls";
    input.policy.includeFileTree = true;
    input.files = Array.from({ length: 205 }, (_, index) => ({
      id: `f${index}`,
      path: `src/file-${index}.ts`,
      embeddingStatus: "EMBEDDING_SUCCESSFUL",
    }));

    const blob = (assembleContext(input)[1] as { content: string }).content;
    expect(blob.includes("src/file-199.ts")).toBe(true);
    expect(blob.includes("and 5 more file(s)")).toBe(true);
    expect(blob.includes("src/file-200.ts")).toBe(false);
  });
});

describe("Entry point determinism", () => {
  test("repeated assembly is fingerprint-stable and reports provenance", async () => {
    const callerInputs: CallerContextInputs = {
      toolHistory: [],
      currentContext: { currentTask: "", iteration: 0, scratchpad: [] },
      promptEmbedding: [],
      systemPrompt: "SYS",
      outputMode: "structured_json",
    };
    const request = {
      projectId: "pj-1",
      agentType: "ARCHITECT" as const,
      task: "t",
      prompt: "p",
      policy: { ...POLICY },
    };

    const first = await buildContext(request, callerInputs);
    const second = await buildContext(request, callerInputs);

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.messages).toEqual(second.messages);
    expect(first.budget.compacted).toBe(false);
    expect(first.budget.usedTokens).toBe(
      24 +
        estimateTokens("SYS") +
        estimateTokens("p") +
        estimateTokens("t"),
    );
    expect(first.sources).toEqual([]);
  });
});
