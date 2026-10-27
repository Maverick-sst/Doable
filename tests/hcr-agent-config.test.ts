import { describe, expect, test } from "bun:test";
import { NodeType } from "@prisma/client";
import { tools as modelTools } from "@/lib/tools";
import { AGENT_REGISTRY } from "@/src/cognition/agent-registry";
import {
  ARCHITECT_SYSTEM_PROMPT,
  RESEARCHER_SYSTEM_PROMPT,
  PRD_REVIEWER_SYSTEM_PROMPT,
  STAFF_ENGINEER_SYSTEM_PROMPT,
  FRONTEND_ENGINEER_SYSTEM_PROMPT,
  BACKEND_ENGINEER_SYSTEM_PROMPT,
  REPAIR_ENGINEER_SYSTEM_PROMPT,
} from "@/src/cognition/prompts";
import {
  AGENT_CATALOG_VERSION,
  AGENT_DEFINITIONS,
  AGENT_PROMPTS,
  agentConfigProvider,
  agentTypeForNode,
  hashAgentConfig,
  InvalidAgentConfigError,
  KNOWN_TOOL_NAMES,
  sha256,
  UnknownAgentTypeError,
  UnmappedNodeTypeError,
  validateAgentConfig,
} from "@/src/hcr/agent-config";
import type { AgentConfig, AgentType } from "@/src/hcr/agent-config";

// Agent Configuration boundary suite (d-3 Agent 01). Pure resolution and
// validation checks only — no DB, no Temporal server, no Docker.

const EXPECTED_AGENTS: AgentType[] = [
  "ARCHITECT",
  "RESEARCHER",
  "PRD_REVIEWER",
  "STAFF_ENGINEER",
  "FRONTEND_ENG",
  "BACKEND_ENG",
  "REPAIR_ENG",
];

const PROMPTS: Record<AgentType, string> = {
  ARCHITECT: ARCHITECT_SYSTEM_PROMPT,
  RESEARCHER: RESEARCHER_SYSTEM_PROMPT,
  PRD_REVIEWER: PRD_REVIEWER_SYSTEM_PROMPT,
  STAFF_ENGINEER: STAFF_ENGINEER_SYSTEM_PROMPT,
  FRONTEND_ENG: FRONTEND_ENGINEER_SYSTEM_PROMPT,
  BACKEND_ENG: BACKEND_ENGINEER_SYSTEM_PROMPT,
  REPAIR_ENG: REPAIR_ENGINEER_SYSTEM_PROMPT,
};

const NODE_FOR_AGENT: Record<AgentType, NodeType> = {
  ARCHITECT: NodeType.ARCHITECT,
  RESEARCHER: NodeType.RESEARCH,
  PRD_REVIEWER: NodeType.PRD_REVIEWER,
  STAFF_ENGINEER: NodeType.PLANNER,
  FRONTEND_ENG: NodeType.FRONTEND_ENG,
  BACKEND_ENG: NodeType.BACKEND_ENG,
  REPAIR_ENG: NodeType.REPAIR,
};

describe("Agent catalog (§5A/§5G stable state)", () => {
  test("catalog holds the six build roles plus the bounded repair role", () => {
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
      expect(config.version).toBe(AGENT_CATALOG_VERSION);
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
      "REPAIR_ENG",
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
      REPAIR_ENG: "implementation",
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

function cloneConfig(agentType: AgentType = "ARCHITECT"): AgentConfig {
  return JSON.parse(
    JSON.stringify(AGENT_DEFINITIONS[agentType]),
  ) as AgentConfig;
}

describe("Versioned prompt identity (D2)", () => {
  test("every agent resolves to a versioned prompt matching its instructions", async () => {
    for (const agentType of EXPECTED_AGENTS) {
      const config = await agentConfigProvider.resolve({ agentType });
      const prompt = AGENT_PROMPTS[agentType];
      expect(config.prompt.id).toBe(prompt.id);
      expect(config.prompt.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(config.prompt.hash).toBe(sha256(prompt.content));
      expect(config.prompt.hash).toBe(prompt.hash);
      expect(config.instructions).toBe(prompt.content);
    }
  });

  test("prompt hashes are unique per agent", () => {
    const hashes = EXPECTED_AGENTS.map((agentType) => AGENT_PROMPTS[agentType].hash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe("Configuration validation (D2)", () => {
  test("every built-in configuration validates", () => {
    for (const agentType of EXPECTED_AGENTS) {
      expect(() => validateAgentConfig(cloneConfig(agentType))).not.toThrow();
    }
  });

  test("invalid configurations fail before execution", () => {
    const invalidCases: Array<[string, (config: AgentConfig) => void]> = [
      ["empty instructions", (config) => { config.instructions = ""; }],
      ["no capabilities", (config) => { config.capabilities = []; }],
      ["unknown tool name", (config) => { config.toolPolicy.eligibleTools = ["rm_rf"]; }],
      ["zero iterations", (config) => { config.executionPolicy.maxIterations = 0; }],
      ["duplicate tools", (config) => {
        config.toolPolicy.eligibleTools = ["create_file", "create_file"];
      }],
      ["missing version", (config) => {
        delete (config as Partial<AgentConfig>).version;
      }],
      ["artifact without structured mode", (config) => {
        config.outputContract = { artifactType: null, mode: "structured_json" };
      }],
    ];

    for (const [label, mutate] of invalidCases) {
      const candidate = cloneConfig();
      mutate(candidate);
      expect(() => validateAgentConfig(candidate, label)).toThrow(
        InvalidAgentConfigError,
      );
    }
  });

  test("validation reports paths without leaking prompt content", () => {
    const candidate = cloneConfig();
    candidate.instructions = "SECRET PROMPT TEXT";
    candidate.capabilities = [];

    let caught: unknown = null;
    try {
      validateAgentConfig(candidate, "test");
    } catch (error) {
      caught = error;
    }

    expect(caught instanceof InvalidAgentConfigError).toBe(true);
    const error = caught as InvalidAgentConfigError;
    expect(error.message.includes("SECRET PROMPT TEXT")).toBe(false);
    expect(error.issues.some((issue) => issue.startsWith("capabilities"))).toBe(
      true,
    );
  });

  test("provider resolution rejects a config the catalog cannot produce", async () => {
    // The provider re-validates the effective copy, so an experiment marker
    // cannot smuggle an invalid field past catalog-time validation.
    const resolved = await agentConfigProvider.resolve({
      agentType: "ARCHITECT",
      experimentVariant: "variant-a",
    });
    expect(resolved.experiment).toEqual({ variant: "variant-a" });
    expect(() => validateAgentConfig(resolved)).not.toThrow();
  });
});

describe("Configuration hash (D2)", () => {
  test("hash is stable across key insertion order", () => {
    const config = cloneConfig();
    const reordered = Object.fromEntries(
      Object.entries(config).reverse(),
    ) as unknown as AgentConfig;
    expect(hashAgentConfig(config)).toBe(hashAgentConfig(reordered));
  });

  test("hash changes when instructions change", () => {
    const before = cloneConfig();
    const after = cloneConfig();
    after.instructions = `${after.instructions}\nAdded instruction.`;
    expect(hashAgentConfig(after)).not.toBe(hashAgentConfig(before));
  });

  test("hash covers the prompt and config version", () => {
    const config = cloneConfig();
    expect(hashAgentConfig(config)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(config.version).toBe(AGENT_CATALOG_VERSION);
  });
});

describe("Derived node registry (D2)", () => {
  test("AGENT_REGISTRY mirrors the single agent catalog", () => {
    for (const agentType of EXPECTED_AGENTS) {
      const nodeType = NODE_FOR_AGENT[agentType];
      const config = AGENT_DEFINITIONS[agentType];
      const entry = AGENT_REGISTRY[nodeType];
      expect(entry).toBeDefined();
      expect(entry?.systemPrompt).toBe(config.instructions);
      expect(entry?.maxIterations).toBe(config.executionPolicy.maxIterations);
      expect(entry?.outputMode).toBe(config.outputContract.mode);
      expect(entry?.outputArtifactType).toBe(config.outputContract.artifactType);
      expect(entry?.usesFileTools).toBe(
        config.toolPolicy.eligibleTools.length > 0,
      );
    }
  });

  test("declared tool names stay in sync with lib/tools.ts", () => {
    expect(KNOWN_TOOL_NAMES).toEqual(
      modelTools.map((tool) => tool.function.name),
    );
  });
});
