import { describe, expect, test } from "bun:test";
import { tools as modelTools } from "@/lib/tools";
import { AGENT_DEFINITIONS, validateAgentConfig } from "@/src/hcr/agent-config";
import type { AgentConfig } from "@/src/hcr/agent-config";
import {
  AgentTurnOutputError,
  runAgentTurn,
  type AgentTurnEvent,
  type AgentTurnModelCall,
  type AgentTurnToolContext,
} from "@/src/hcr/agent-turn";
import type { ChatResult, NormalizedToolCall } from "@/src/providers";

// The reusable agent turn, driven entirely by fakes: no provider, no DB, no
// Temporal. This is the acceptance requirement that the loop is testable with
// fake model/tool adapters.

function result(partial: Partial<ChatResult>): ChatResult {
  return {
    content: null,
    toolCalls: [],
    model: "fake-model",
    provider: "fake-provider",
    ...partial,
  };
}

function toolCall(
  name: string,
  args: Record<string, unknown>,
  id: string,
): NormalizedToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

function queueModel(responses: ChatResult[]) {
  const calls: AgentTurnModelCall[] = [];
  return {
    calls,
    model: {
      async call(input: AgentTurnModelCall): Promise<ChatResult> {
        calls.push(input);
        const next = responses.shift();
        if (!next) throw new Error("fake model ran out of responses");
        return next;
      },
    },
  };
}

function configWithTools(eligibleTools: string[]): AgentConfig {
  const config = JSON.parse(
    JSON.stringify(AGENT_DEFINITIONS.FRONTEND_ENG),
  ) as AgentConfig;
  config.toolPolicy.eligibleTools = eligibleTools;
  return validateAgentConfig(config, "test");
}

describe("Structured-output turn", () => {
  test("retries with the validation error, then completes", async () => {
    const { model, calls } = queueModel([
      result({ content: "not json" }),
      result({ content: '{"ok":true}' }),
    ]);
    const events: AgentTurnEvent[] = [];

    const outcome = await runAgentTurn({
      config: AGENT_DEFINITIONS.ARCHITECT,
      mode: "structured_json",
      messages: [{ role: "user", content: "produce the spec" }],
      model,
      validateOutput: (content) => {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        if (!parsed.ok) throw new Error("missing ok");
        return parsed;
      },
      onEvent: async (event) => {
        events.push(event);
      },
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    expect(outcome.output).toEqual({ ok: true });
    expect(calls.length).toBe(2);
    const correction = calls[1].messages.at(-1);
    expect(correction?.role).toBe("user");
    expect(String(correction?.content)).toContain("not valid JSON");
    expect(calls.every((call) => call.responseFormat === "json")).toBe(true);
    expect(calls.every((call) => call.tools.length === 0)).toBe(true);
    expect(events.filter((event) => event.type === "model.usage")).toHaveLength(2);
  });

  test("fails after three invalid replies instead of looping", async () => {
    const { model, calls } = queueModel([
      result({ content: '{"missing":true}' }),
      result({ content: "still not json" }),
      result({ content: '{"missing":true}' }),
    ]);

    let caught: unknown = null;
    try {
      await runAgentTurn({
        config: AGENT_DEFINITIONS.ARCHITECT,
        mode: "structured_json",
        messages: [],
        model,
        validateOutput: () => {
          throw new Error("schema mismatch");
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught instanceof AgentTurnOutputError).toBe(true);
    expect(calls.length).toBe(3);
  });
});

describe("Tool turn", () => {
  test("continues through tool calls and finishes on the completion tool", async () => {
    const { model, calls } = queueModel([
      result({
        toolCalls: [toolCall("create_file", { path: "a.ts", content: "x" }, "c1")],
      }),
      result({ toolCalls: [toolCall("mark_complete", {}, "c2")] }),
    ]);
    const executed: string[] = [];
    const events: AgentTurnEvent[] = [];

    const outcome = await runAgentTurn({
      config: AGENT_DEFINITIONS.FRONTEND_ENG,
      mode: "tool_calls",
      messages: [],
      tools: modelTools,
      maxIterations: 10,
      model,
      toolRunner: {
        async execute({ name }) {
          executed.push(name);
          return name === "mark_complete"
            ? { content: "completed", completesTurn: true }
            : { content: "created a.ts" };
        },
      },
      onEvent: async (event) => {
        events.push(event);
      },
    });

    expect(outcome.status).toBe("completed");
    expect(outcome.iterations).toBe(2);
    expect(executed).toEqual(["create_file", "mark_complete"]);
    expect(
      events.filter((event) => event.type === "tool.called").length,
    ).toBe(2);
    expect(outcome.toolHistory).toContainEqual({
      role: "tool",
      content: "created a.ts",
      tool_call_id: "c1",
    });
    // The model sees only tools the configuration allows.
    expect(calls[0].tools.map((tool) => tool.function.name).sort()).toEqual(
      [...AGENT_DEFINITIONS.FRONTEND_ENG.toolPolicy.eligibleTools].sort(),
    );
  });

  test("stops as incomplete at the iteration budget and keeps history", async () => {
    const { model } = queueModel([
      result({ toolCalls: [toolCall("create_file", { path: "a", content: "" }, "c1")] }),
      result({ toolCalls: [toolCall("create_file", { path: "b", content: "" }, "c2")] }),
      result({ toolCalls: [toolCall("mark_complete", {}, "c3")] }),
    ]);
    let executed = 0;

    const outcome = await runAgentTurn({
      config: AGENT_DEFINITIONS.FRONTEND_ENG,
      mode: "tool_calls",
      messages: [],
      tools: modelTools,
      maxIterations: 2,
      model,
      toolRunner: {
        async execute() {
          executed++;
          return { content: "ok" };
        },
      },
    });

    expect(outcome.status).toBe("incomplete");
    if (outcome.status !== "incomplete") throw new Error("unreachable");
    expect(outcome.reason).toBe("iterations");
    expect(outcome.iterations).toBe(2);
    expect(executed).toBe(2);
    expect(outcome.toolHistory.length).toBeGreaterThan(0);
  });

  test("stops as incomplete on the wall clock", async () => {
    const { model } = queueModel([
      result({ toolCalls: [toolCall("create_file", { path: "a", content: "" }, "c1")] }),
    ]);
    let tick = 0;
    const now = () => {
      const value = tick;
      tick += 10;
      return value;
    };

    const outcome = await runAgentTurn({
      config: AGENT_DEFINITIONS.FRONTEND_ENG,
      mode: "tool_calls",
      messages: [],
      tools: modelTools,
      maxIterations: 5,
      wallClockMs: 15,
      model,
      toolRunner: { async execute() { return { content: "ok" }; } },
      now,
    });

    expect(outcome.status).toBe("incomplete");
    if (outcome.status !== "incomplete") throw new Error("unreachable");
    expect(outcome.reason).toBe("wall_clock");
    expect(outcome.iterations).toBe(1);
  });

  test("denies a tool the configuration does not allow", async () => {
    const { model, calls } = queueModel([
      result({ toolCalls: [toolCall("delete_file", { path: "a" }, "c1")] }),
      result({ content: "done" }),
    ]);
    const events: AgentTurnEvent[] = [];
    const executed: string[] = [];

    const outcome = await runAgentTurn({
      config: configWithTools(["create_file"]),
      mode: "tool_calls",
      messages: [],
      tools: modelTools,
      maxIterations: 5,
      model,
      toolRunner: {
        async execute({ name }) {
          executed.push(name);
          return { content: "ok" };
        },
      },
      onEvent: async (event) => {
        events.push(event);
      },
    });

    expect(outcome.status).toBe("stopped");
    expect(executed).toEqual([]);
    expect(calls[0].tools.map((tool) => tool.function.name)).toEqual([
      "create_file",
    ]);
    expect(events.some((event) => event.type === "tool.denied")).toBe(true);
    expect(
      outcome.toolHistory.some(
        (entry) =>
          entry.role === "tool" && entry.content.includes("not permitted"),
      ),
    ).toBe(true);
  });

  test("reports invalid tool arguments without executing the tool", async () => {
    const { model } = queueModel([
      result({
        toolCalls: [{ id: "c1", name: "create_file", arguments: "not json" }],
      }),
      result({ toolCalls: [toolCall("mark_complete", {}, "c2")] }),
    ]);
    const executed: string[] = [];

    const outcome = await runAgentTurn({
      config: AGENT_DEFINITIONS.FRONTEND_ENG,
      mode: "tool_calls",
      messages: [],
      tools: modelTools,
      maxIterations: 5,
      model,
      toolRunner: {
        async execute({ name }) {
          executed.push(name);
          return name === "mark_complete"
            ? { content: "completed", completesTurn: true }
            : { content: "ok" };
        },
      },
    });

    expect(outcome.status).toBe("completed");
    expect(executed).toEqual(["mark_complete"]);
    expect(
      outcome.toolHistory.some(
        (entry) =>
          entry.role === "tool" &&
          entry.content === "Error: tool arguments were not valid JSON",
      ),
    ).toBe(true);
  });

  test("rebuilds context between iterations with accumulated tool history", async () => {
    const { model } = queueModel([
      result({ toolCalls: [toolCall("read_file", { path: "a" }, "c1")] }),
      result({ toolCalls: [toolCall("mark_complete", {}, "c2")] }),
    ]);
    const states: AgentTurnToolContext[] = [];

    await runAgentTurn({
      config: AGENT_DEFINITIONS.FRONTEND_ENG,
      mode: "tool_calls",
      messages: [],
      tools: modelTools,
      maxIterations: 5,
      model,
      nextMessages: async (state) => {
        // The turn mutates its history in place; snapshot for assertions.
        states.push({
          toolHistory: [...state.toolHistory],
          iteration: state.iteration,
          scratchpad: [...state.scratchpad],
        });
        return [{ role: "user", content: `iteration ${state.iteration}` }];
      },
      toolRunner: {
        async execute({ name }) {
          return name === "mark_complete"
            ? { content: "completed", completesTurn: true }
            : { content: "file body" };
        },
      },
    });

    expect(states).toHaveLength(2);
    expect(states[0].toolHistory).toHaveLength(0);
    expect(states[1].toolHistory).toHaveLength(2);
    expect(states[1].scratchpad[0]).toContain("read_file()");
  });

  test("trusted identity never reaches the model adapter", async () => {
    const { model, calls } = queueModel([
      result({ toolCalls: [toolCall("mark_complete", {}, "c1")] }),
    ]);

    await runAgentTurn({
      config: AGENT_DEFINITIONS.FRONTEND_ENG,
      mode: "tool_calls",
      messages: [],
      tools: modelTools,
      model,
      toolRunner: {
        async execute() {
          return { content: "completed", completesTurn: true };
        },
      },
    });

    const serialized = JSON.stringify(calls[0]);
    expect(serialized.includes("projectId")).toBe(false);
    expect(serialized.includes("userId")).toBe(false);
    expect(serialized.includes("workspace")).toBe(false);
    expect(Object.keys(calls[0]).sort()).toEqual(["messages", "tools"]);
  });

  test("requires a tool runner when the model calls a tool", async () => {
    const { model } = queueModel([
      result({ toolCalls: [toolCall("create_file", { path: "a", content: "" }, "c1")] }),
    ]);

    let caught: unknown = null;
    try {
      await runAgentTurn({
        config: AGENT_DEFINITIONS.FRONTEND_ENG,
        mode: "tool_calls",
        messages: [],
        tools: modelTools,
        model,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught instanceof Error).toBe(true);
    expect(String((caught as Error).message)).toContain("requires a toolRunner");
  });
});
