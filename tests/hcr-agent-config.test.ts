import { describe, expect, test } from "bun:test";
import { NodeType } from "@prisma/client";
import { AGENT_REGISTRY } from "@/src/cognition/agent-registry";
import {
  ARCHITECT_SYSTEM_PROMPT,
  RESEARCHER_SYSTEM_PROMPT,
  PRD_REVIEWER_SYSTEM_PROMPT,
  STAFF_ENGINEER_SYSTEM_PROMPT,
  FRONTEND_ENGINEER_SYSTEM_PROMPT,
  BACKEND_ENGINEER_SYSTEM_PROMPT,
} from "@/src/cognition/prompts";
import {
  AGENT_DEFINITIONS,
  agentConfigProvider,
  agentTypeForNode,
  UnknownAgentTypeError,
  UnmappedNodeTypeError,
} from "@/src/hcr/agent-config";
import type { AgentType } from "@/src/hcr/agent-config";

// Agent Configuration boundary suite (d-3 Agent 01). Pure resolution checks
// only — no DB, no Temporal server, no Docker. Notably this file never
// imports `@/lib/tools`: eligibility must be names-only by construction.

const EXPECTED_AGENTS: AgentType[] = [
  "ARCHITECT",
  "RESEARCHER",
  "PRD_REVIEWER",
  "STAFF_ENGINEER",
  "FRONTEND_ENG",
  "BACKEND_ENG",
];

const PROMPTS: Record<AgentType, string> = {
  ARCHITECT: ARCHITECT_SYSTEM_PROMPT,
  RESEARCHER: RESEARCHER_SYSTEM_PROMPT,
  PRD_REVIEWER: PRD_REVIEWER_SYSTEM_PROMPT,
  STAFF_ENGINEER: STAFF_ENGINEER_SYSTEM_PROMPT,
  FRONTEND_ENG: FRONTEND_ENGINEER_SYSTEM_PROMPT,
  BACKEND_ENG: BACKEND_ENGINEER_SYSTEM_PROMPT,
};

const NODE_FOR_AGENT: Record<AgentType, NodeType> = {
  ARCHITECT: NodeType.ARCHITECT,
  RESEARCHER: NodeType.RESEARCH,
  PRD_REVIEWER: NodeType.PRD_REVIEWER,
  STAFF_ENGINEER: NodeType.PLANNER,
  FRONTEND_ENG: NodeType.FRONTEND_ENG,
  BACKEND_ENG: NodeType.BACKEND_ENG,
};

describe("Agent catalog (§5A/§5G stable state)", () => {
  test("catalog holds exactly the six existing roles — no invented agents", () => {
    expect(Object.keys(AGENT_DEFINITIONS).sort()).toEqual(
      [...EXPECTED_AGENTS].sort(),
    );
  });

  test("every definition carries the §5 contract shape", () => {
    for (const agentType of EXPECTED_AGENTS) {
      const config = AGENT_DEFINITIONS[agentType];
      expect(config.agentId.length).toBeGreaterThan(0);
      expect(config.agentType).toBe(agentType);
      expect(config.instructions.length).toBeGreaterThan(0);
      expect(config.capabilities.length).toBeGreaterThan(0);
      expect(config.version).toBe("1");
    }
  });
});

describe("Configuration resolution", () => {
  test("known agent type resolves with execution-scoped extras ignored", async () => {
    const config = await agentConfigProvider.resolve({
      agentType: "ARCHITECT",
      projectId: "pj-1",
      executionId: "ex-1",
    });
    expect(config.agentType).toBe("ARCHITECT");
    expect(config.agentId).toBe("architect");
    expect("projectId" in config).toBe(false);
    expect("executionId" in config).toBe(false);
    expect("nodeId" in config).toBe(false);
  });

  test("unknown agent type fails explicitly", async () => {
    let caught: unknown = null;
    try {
      await agentConfigProvider.resolve({
        agentType: "CACHE_AGENT" as AgentType,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof UnknownAgentTypeError).toBe(true);
  });

  test("experiment variant passes through verbatim; absent stays absent", async () => {
    const withVariant = await agentConfigProvider.resolve({
      agentType: "RESEARCHER",
      experimentVariant: "prompt-v2",
    });
    expect(withVariant.experiment).toEqual({ variant: "prompt-v2" });
    const plain = await agentConfigProvider.resolve({
      agentType: "RESEARCHER",
    });
    expect(plain.experiment).toBe(undefined);
  });
});

describe("Node-to-agent mapping (§5B)", () => {
  test("every catalog node maps to its agent, preserving PLANNER quirk", () => {
    for (const agentType of EXPECTED_AGENTS) {
      expect(agentTypeForNode(NODE_FOR_AGENT[agentType])).toBe(agentType);
    }
    expect(agentTypeForNode(NodeType.PLANNER)).toBe("STAFF_ENGINEER");
  });

  test("unmapped node types fail explicitly (§5F protocol)", () => {
    expect(() => agentTypeForNode(NodeType.WORKER)).toThrow(
      UnmappedNodeTypeError,
    );
    expect(() => agentTypeForNode(NodeType.DISCOVERY)).toThrow(
      UnmappedNodeTypeError,
    );
  });
});

describe("Configuration isolation", () => {
  test("resolved configs are frozen and independent across resolutions", async () => {
    const first = await agentConfigProvider.resolve({
      agentType: "ARCHITECT",
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first.capabilities as string[]).push("web-access");
    }).toThrow();
    const second = await agentConfigProvider.resolve({
      agentType: "ARCHITECT",
    });
    expect(second.capabilities).toEqual(
      AGENT_DEFINITIONS["ARCHITECT"].capabilities,
    );
    expect(second).not.toBe(first);
  });
});

describe("Tool eligibility (names only, catalog never loaded)", () => {
  test("structured agents declare zero eligible tools", async () => {
    for (const agentType of [
      "ARCHITECT",
      "RESEARCHER",
      "PRD_REVIEWER",
      "STAFF_ENGINEER",
    ] as AgentType[]) {
      const config = await agentConfigProvider.resolve({ agentType });
      expect(config.toolPolicy.eligibleTools).toEqual([]);
    }
  });

  test("file-tool agents declare exactly the lib/tools.ts names", async () => {
    const expected = [
      "create_file",
      "edit_file",
      "read_file",
      "delete_file",
      "mark_complete",
    ];
    for (const agentType of [
      "FRONTEND_ENG",
      "BACKEND_ENG",
    ] as AgentType[]) {
      const config = await agentConfigProvider.resolve({ agentType });
      expect(config.toolPolicy.eligibleTools).toEqual(expected);
    }
  });
});

describe("Model policy (preferences only, no provider)", () => {
  test("every agent states a task profile with fallback allowed", async () => {
    const profiles: Record<AgentType, string> = {
      ARCHITECT: "reasoning",
      RESEARCHER: "reasoning",
      PRD_REVIEWER: "reasoning",
      STAFF_ENGINEER: "planning",
      FRONTEND_ENG: "implementation",
      BACKEND_ENG: "implementation",
    };
    for (const agentType of EXPECTED_AGENTS) {
      const config = await agentConfigProvider.resolve({ agentType });
      expect(config.modelPolicy.taskProfile).toBe(profiles[agentType]);
      expect(config.modelPolicy.allowFallback).toBe(true);
    }
  });

  test("policy carries no invocation material (no URLs, keys, tokens)", async () => {
    for (const agentType of EXPECTED_AGENTS) {
      const config = await agentConfigProvider.resolve({ agentType });
      const serialized = JSON.stringify(config.modelPolicy).toLowerCase();
      expect(serialized.includes("http")).toBe(false);
      expect(serialized.includes("bearer")).toBe(false);
      expect(serialized.includes("api_key")).toBe(false);
      expect(serialized.includes("apikey")).toBe(false);
    }
  });
});

describe("Prompt preservation (§5D hard requirement)", () => {
  test("resolved instructions equal the live prompt constants verbatim", async () => {
    for (const agentType of EXPECTED_AGENTS) {
      const config = await agentConfigProvider.resolve({ agentType });
      expect(config.instructions).toBe(PROMPTS[agentType]);
    }
  });

  test("instructions match what the HCR nodes actually use today", async () => {
    for (const agentType of EXPECTED_AGENTS) {
      const config = await agentConfigProvider.resolve({ agentType });
      const registryEntry = AGENT_REGISTRY[NODE_FOR_AGENT[agentType]];
      expect(registryEntry?.systemPrompt).toBe(config.instructions);
    }
  });
});

describe("Execution policy mirror", () => {
  test("maxIterations matches the registry source of truth", async () => {
    for (const agentType of EXPECTED_AGENTS) {
      const config = await agentConfigProvider.resolve({ agentType });
      const registryEntry = AGENT_REGISTRY[NODE_FOR_AGENT[agentType]];
      expect(config.executionPolicy.maxIterations).toBe(
        registryEntry?.maxIterations,
      );
    }
  });
});
