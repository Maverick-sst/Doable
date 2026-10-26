import { describe, expect, test } from "bun:test";
import { ArtifactType, NodeType } from "@prisma/client";
import { AGENT_REGISTRY } from "@/src/cognition/agent-registry";
import { assembleContext } from "@/src/hcr/context-engine/assembler";
import type { AssembleContextInput } from "@/src/hcr/context-engine/assembler";

// Pure assembler regression suite (Agent 02). No DB, no server: every input
// is hand-built, covering both output modes and all six registry configs.
// DB-backed retrieval (latest-version artifacts, pgvector top-5) moved
// verbatim and is owner-verified live via HCR runs.

function baseInput(): AssembleContextInput {
  return {
    systemPrompt: "SYS",
    prompt: "do the thing",
    task: "do the thing",
    policy: {
      consumedArtifactTypes: [],
      includeFileTree: false,
      includeVectorSearch: false,
      includeMessageHistory: false,
    },
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

describe("Context assembly ordering", () => {
  test("structured mode emits [system, user-blob, prompt] with task fallback", () => {
    const messages = assembleContext(baseInput());
    expect(messages.length).toBe(3);
    expect(messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(messages[2]).toEqual({ role: "user", content: "do the thing" });
    const blob = (messages[1] as { content: string }).content;
    expect(blob.includes("=== CURRENT TASK ===")).toBe(true);
    expect(blob.includes("do the thing")).toBe(true);
  });

  test("task renders verbatim from the resolved field", () => {
    const input = baseInput();
    input.task = "explicit task";
    const messages = assembleContext(input);
    expect(
      ((messages[1] as { content: string }).content.includes("explicit task")),
    ).toBe(true);
  });

  test("history and tool messages slot between blob and final prompt", () => {
    const input = baseInput();
    input.policy.includeMessageHistory = true;
    input.messages = [{ role: "USER", content: "hi" }];
    input.outputMode = "tool_calls";
    input.toolHistory = [
      { role: "tool", content: "out", tool_call_id: "c1" },
    ];
    const messages = assembleContext(input);
    expect(messages.length).toBe(3 + 1 + 1);
    expect(messages[2]).toEqual({ role: "user", content: "hi" });
    expect(messages[3]).toEqual({
      role: "tool",
      content: "out",
      tool_call_id: "c1",
    });
  });
});

describe("Artifact sections", () => {
  test("multiple artifacts join with versioned headers", () => {
    const input = baseInput();
    input.artifacts = [
      { type: ArtifactType.ARCHITECTURE_SPEC, version: 2, content: { a: 1 } },
      { type: ArtifactType.DISCOVERY_REQUIREMENT, version: 1, content: {} },
    ];
    const blob = (
      assembleContext(input)[1] as { content: string }
    ).content;
    expect(
      blob.includes("=== PROJECT ARCHITECTURE_SPEC (Version 2) ==="),
    ).toBe(true);
    expect(
      blob.includes("=== PROJECT DISCOVERY_REQUIREMENT (Version 1) ==="),
    ).toBe(true);
  });
});

describe("File sections (tool mode)", () => {
  test("file tree lists paths or the empty placeholder", () => {
    const withFiles = baseInput();
    withFiles.outputMode = "tool_calls";
    withFiles.policy.includeFileTree = true;
    withFiles.files = [{ id: "1", path: "a.ts", embeddingStatus: "x" }];
    expect(
      (assembleContext(withFiles)[1] as { content: string }).content.includes(
        "=== FILE TREE ===\na.ts",
      ),
    ).toBe(true);

    const empty = baseInput();
    empty.outputMode = "tool_calls";
    empty.policy.includeFileTree = true;
    expect(
      (assembleContext(empty)[1] as { content: string }).content.includes(
        "No files yet!",
      ),
    ).toBe(true);
  });

  test("relevant files join with separators or show the fallback", () => {
    const input = baseInput();
    input.outputMode = "tool_calls";
    input.policy.includeVectorSearch = true;
    input.promptEmbedding = [0.1];
    input.relevantFiles = [
      { path: "a.ts", snippet: "aaa" },
      { path: "b.ts", snippet: "bbb" },
    ];
    expect(
      (assembleContext(input)[1] as { content: string }).content.includes(
        "[a.ts]\naaa\n---\n[b.ts]\nbbb",
      ),
    ).toBe(true);
  });

  test("vector flag with empty embedding emits no section at all", () => {
    const input = baseInput();
    input.outputMode = "tool_calls";
    input.policy.includeVectorSearch = true;
    input.promptEmbedding = [];
    expect(
      (assembleContext(input)[1] as { content: string }).content.includes(
        "RELEVANT FILES",
      ),
    ).toBe(false);
  });

  test("structured mode never renders file sections", () => {
    const input = baseInput();
    input.files = [{ id: "1", path: "a.ts", embeddingStatus: "x" }];
    input.relevantFiles = [{ path: "a.ts", snippet: "aaa" }];
    input.promptEmbedding = [0.1];
    const blob = (assembleContext(input)[1] as { content: string }).content;
    expect(blob.includes("FILE TREE")).toBe(false);
    expect(blob.includes("RELEVANT FILES")).toBe(false);
    expect(blob.includes("SCRATCHPAD")).toBe(false);
  });
});

describe("Message history gate", () => {
  test("disabled by default; enabled lowercases roles", () => {
    expect(assembleContext(baseInput()).length).toBe(3);
    const input = baseInput();
    input.policy.includeMessageHistory = true;
    input.messages = [
      { role: "USER", content: "q" },
      { role: "ASSISTANT", content: "a" },
    ];
    const messages = assembleContext(input);
    expect(messages[2]).toEqual({ role: "user", content: "q" });
    expect(messages[3]).toEqual({ role: "assistant", content: "a" });
  });
});

describe("Scratchpad budget (last-8)", () => {
  test("keeps the last 8 entries with the empty fallback", () => {
    const input = baseInput();
    input.outputMode = "tool_calls";
    input.currentContext.scratchpad = Array.from(
      { length: 10 },
      (_, i) => `step-${i}`,
    );
    const blob = (assembleContext(input)[1] as { content: string }).content;
    expect(blob.includes("step-0")).toBe(false);
    expect(blob.includes("step-1")).toBe(false);
    expect(blob.includes("step-9")).toBe(true);
    expect(blob.includes("RECENT SCRATCHPAD (last 8 steps)")).toBe(true);

    const empty = baseInput();
    empty.outputMode = "tool_calls";
    expect(
      (assembleContext(empty)[1] as { content: string }).content.includes(
        "No previous steps yet",
      ),
    ).toBe(true);
  });
});

describe("Tool history mapping", () => {
  test("assistant calls, tool results, and fallbacks map exactly", () => {
    const input = baseInput();
    input.outputMode = "tool_calls";
    const calls = [
      { id: "c1", type: "function", function: { name: "x", arguments: "{}" } },
    ];
    input.toolHistory = [
      { role: "assistant", content: "thinking", tool_calls: calls },
      { role: "tool", content: null, tool_call_id: "c1" },
      { role: "assistant", content: null },
    ];
    const messages = assembleContext(input);
    expect(messages.length).toBe(6);
    expect(messages[2]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: calls,
    });
    expect(messages[4]).toEqual({ role: "assistant", content: "" });
    expect(messages[5]).toEqual({
      role: "user",
      content: "do the thing",
    });
    const toolMsg = messages.find(
      (m) => (m as { tool_call_id?: string }).tool_call_id === "c1",
    ) as { content: string };
    expect(toolMsg.content).toBe("(no output)");
  });

  test("empty history contributes no messages", () => {
    const input = baseInput();
    input.outputMode = "tool_calls";
    expect(assembleContext(input).length).toBe(3);
  });
});

describe("Removed input seam (locked, not reintroduced)", () => {
  test("assembly takes an explicit task and no inputArtifactContent field", () => {
    const input = baseInput();
    expect("inputArtifactContent" in input).toBe(false);
    expect(input.task).toBe("do the thing");
  });
});

describe("Six registry configs keep their current context shape", () => {
  test("structured nodes stay file/history/tool-free", () => {
    const structured = [
      NodeType.ARCHITECT,
      NodeType.RESEARCH,
      NodeType.PRD_REVIEWER,
      NodeType.PLANNER,
    ];
    for (const nodeType of structured) {
      const entry = AGENT_REGISTRY[nodeType];
      expect(entry?.outputMode).toBe("structured_json");
      expect(entry?.contextConfig.includeFileTree).toBe(false);
      expect(entry?.contextConfig.includeVectorSearch).toBe(false);
      expect(entry?.contextConfig.includeMessageHistory).toBe(false);
    }
  });

  test("file-tool nodes keep tree + vector context without history", () => {
    for (const nodeType of [NodeType.FRONTEND_ENG, NodeType.BACKEND_ENG]) {
      const entry = AGENT_REGISTRY[nodeType];
      expect(entry?.outputMode).toBe("tool_calls");
      expect(entry?.contextConfig.includeFileTree).toBe(true);
      expect(entry?.contextConfig.includeVectorSearch).toBe(true);
      expect(entry?.contextConfig.includeMessageHistory).toBe(false);
    }
  });
});

describe("Context Engine entry point (runtime contract)", () => {
  test("accepts a valid ContextRequest and returns a ContextResult", async () => {
    const { buildContext } = await import(
      "@/src/hcr/context-engine/engine"
    );
    const result = await buildContext(
      {
        projectId: "pj-1",
        executionId: "ex-1",
        nodeId: "nd-1",
        agentType: "ARCHITECT",
        task: "do the thing",
        prompt: "do the thing",
        policy: {
          consumedArtifactTypes: [],
          includeFileTree: false,
          includeVectorSearch: false,
          includeMessageHistory: false,
        },
      },
      {
        toolHistory: [],
        currentContext: { currentTask: "", iteration: 0, scratchpad: [] },
        promptEmbedding: [],
        systemPrompt: "SYS",
        outputMode: "structured_json",
      },
    );
    expect(result.messages.length).toBe(3);
    expect(result.messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(result.messages[2]).toEqual({
      role: "user",
      content: "do the thing",
    });
  });

  test("identity fields ride along without changing assembled behavior", async () => {
    const { buildContext } = await import(
      "@/src/hcr/context-engine/engine"
    );
    const callerInputs = {
      toolHistory: [],
      currentContext: { currentTask: "", iteration: 0, scratchpad: [] as string[] },
      promptEmbedding: [] as number[],
      systemPrompt: "SYS",
      outputMode: "structured_json" as const,
    };
    const policy = {
      consumedArtifactTypes: [],
      includeFileTree: false,
      includeVectorSearch: false,
      includeMessageHistory: false,
    };
    const first = await buildContext(
      {
        projectId: "pj-1",
        executionId: "ex-1",
        nodeId: "nd-1",
        agentType: "ARCHITECT",
        task: "t",
        prompt: "p",
        policy,
      },
      callerInputs,
    );
    const second = await buildContext(
      {
        projectId: "pj-9",
        executionId: "ex-9",
        nodeId: "nd-9",
        agentType: "FRONTEND_ENG",
        task: "t",
        prompt: "p",
        policy,
      },
      callerInputs,
    );
    expect(second.messages).toEqual(first.messages);
  });

  test("caller inputs propagate: tool history, task, scratchpad (files/messages are engine-retrieved)", async () => {
    const { buildContext } = await import(
      "@/src/hcr/context-engine/engine"
    );
    const result = await buildContext(
      {
        projectId: "pj-1",
        agentType: "FRONTEND_ENG",
        task: "live task",
        prompt: "do the thing",
        policy: {
          consumedArtifactTypes: [],
          includeFileTree: false,
          includeVectorSearch: false,
          includeMessageHistory: false,
        },
      },
      {
        toolHistory: [{ role: "tool", content: "ok", tool_call_id: "c9" }],
        currentContext: { currentTask: "live task", iteration: 3, scratchpad: ["s1"] },
        promptEmbedding: [0.5],
        systemPrompt: "FE-SYS",
        outputMode: "tool_calls",
      },
    );
    const blob = (result.messages[1] as { content: string }).content;
    expect(blob.includes("live task")).toBe(true);
    expect(blob.includes("s1")).toBe(true);
    expect(
      result.messages.some(
        (m) => (m as { tool_call_id?: string }).tool_call_id === "c9",
      ),
    ).toBe(true);
  });

  test("empty embedding short-circuits relevant-file retrieval without DB", async () => {
    const { retrieveRelevantFiles } = await import(
      "@/src/hcr/context-engine/retrievers/relevant-files"
    );
    expect(await retrieveRelevantFiles("pj-1", [])).toEqual([]);
  });

  test("empty request task falls back to prompt (first-pass parity)", async () => {
    const { buildContext } = await import(
      "@/src/hcr/context-engine/engine"
    );
    const result = await buildContext(
      {
        projectId: "pj-1",
        agentType: "ARCHITECT",
        task: "",
        prompt: "fallback prompt",
        policy: {
          consumedArtifactTypes: [],
          includeFileTree: false,
          includeVectorSearch: false,
          includeMessageHistory: false,
        },
      },
      {
        toolHistory: [],
        currentContext: { currentTask: "", iteration: 0, scratchpad: [] },
        promptEmbedding: [],
        systemPrompt: "SYS",
        outputMode: "structured_json",
      },
    );
    expect(
      (result.messages[1] as { content: string }).content.includes(
        "fallback prompt",
      ),
    ).toBe(true);
  });
});
