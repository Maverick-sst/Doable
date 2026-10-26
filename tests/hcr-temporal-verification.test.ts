import { describe, expect, test } from "bun:test";
import { ArtifactType, NodeType } from "@prisma/client";
import {
  buildHcrWorkflowId,
  isHcrDomainFailure,
} from "@/src/temporal/contracts/hcr";
import { AGENT_REGISTRY } from "@/src/cognition/agent-registry";
import { HCR_TRANSITION_MAP } from "@/src/runtime/workflows/hcr/transition-map";
import {
  DEFAULT_TOOL_NODE_ITERATIONS,
  resolveNodeBudget,
} from "@/src/runtime/budgets";

// Agent 04 offline equivalence suite: pure contract/cognition checks only.
// No DB, no Temporal server, no Docker. Runtime scenarios (happy path, retry,
// terminal failure, worker restart, pilot regression) are user-executed per
// d-2/hcr/HCR_TEMPORAL_VERIFICATION.md and recorded there.

const identity = {
  workflowId: "wf-1",
  executionId: "ex-1",
  nodeId: "nd-1",
  projectId: "pj-1",
  userId: "u-1",
};

describe("HCR workflow identity (duplicate-trigger safety)", () => {
  test("workflow ID is deterministic from executionId", () => {
    expect(buildHcrWorkflowId(identity)).toBe("hcr-ex-1");
    expect(buildHcrWorkflowId(identity)).toBe(buildHcrWorkflowId(identity));
  });

  test("distinct executions map to distinct workflow IDs (no cross-talk)", () => {
    expect(buildHcrWorkflowId({ ...identity, executionId: "ex-2" })).toBe(
      "hcr-ex-2",
    );
  });

  test("workflow ID ignores mutable fields (prompt/taskId do not fork identity)", () => {
    expect(
      buildHcrWorkflowId({ ...identity, taskId: "task-a" }),
    ).toBe(buildHcrWorkflowId({ ...identity, taskId: "task-b" }));
  });
});

describe("ARCHITECT failure classification (retry vs terminal)", () => {
  test("exhausted LLM JSON validation is terminal (already retried 3x inside)", () => {
    expect(
      isHcrDomainFailure(
        "Failed to parse/validate JSON output for ARCHITECT after 3 attempts",
      ),
    ).toBe(true);
  });

  test("missing records are terminal", () => {
    expect(isHcrDomainFailure("Execution ex-1 not found")).toBe(true);
    expect(
      isHcrDomainFailure("Execution ex-1 does not belong to workflow wf-1"),
    ).toBe(true);
  });

  test("transport errors stay retryable", () => {
    expect(isHcrDomainFailure("fetch failed: ECONNREFUSED")).toBe(false);
    expect(isHcrDomainFailure("Rate limit exceeded (429)")).toBe(false);
    expect(isHcrDomainFailure("")).toBe(false);
  });
});

describe("ARCHITECT cognition parity (orchestration moved, intelligence kept)", () => {
  test("registry wires ARCHITECT to ARCHITECTURE_SPEC from DISCOVERY_REQUIREMENT", () => {
    const config = AGENT_REGISTRY[NodeType.ARCHITECT];
    expect(config).toBeDefined();
    expect(config?.outputArtifactType).toBe(ArtifactType.ARCHITECTURE_SPEC);
    expect(config?.consumedArtifactTypes).toEqual([
      ArtifactType.DISCOVERY_REQUIREMENT,
    ]);
    expect(config?.outputMode).toBe("structured_json");
    expect(config?.usesFileTools).toBe(false);
  });

  test("transition map continues ARCHITECTURE_SPEC to RESEARCH (next slice)", () => {
    const entry = HCR_TRANSITION_MAP[ArtifactType.ARCHITECTURE_SPEC];
    expect(entry?.nextNodes).toEqual([NodeType.RESEARCH]);
    expect(entry?.order).toBe(2);
  });

  test("full chain preserved through EXECUTION_PLAN fan-out", () => {
    expect(
      HCR_TRANSITION_MAP[ArtifactType.EXECUTION_PLAN]?.nextNodes,
    ).toEqual([NodeType.FRONTEND_ENG, NodeType.BACKEND_ENG]);
  });
});

describe("Full-graph wrap parity (generic activity + coordinator port)", () => {
  test("every registry node carries a complete contract", () => {
    const expected: NodeType[] = [
      NodeType.ARCHITECT,
      NodeType.RESEARCH,
      NodeType.PRD_REVIEWER,
      NodeType.PLANNER,
      NodeType.FRONTEND_ENG,
      NodeType.BACKEND_ENG,
    ];
    for (const nodeType of expected) {
      const config = AGENT_REGISTRY[nodeType];
      expect(config).toBeDefined();
      expect(config?.nodeType).toBe(nodeType);
      expect(config?.consumedArtifactTypes.length).toBeGreaterThan(0);
      if (config?.outputMode === "structured_json") {
        expect(config.usesFileTools).toBe(false);
        expect(config.outputArtifactType).not.toBeNull();
      } else {
        expect(config?.usesFileTools).toBe(true);
        expect(config?.outputArtifactType).toBeNull();
      }
    }
  });

  test("structured chain links ARCHITECT to EXECUTION_PLAN without gaps", () => {
    const chain: Array<[ArtifactType, NodeType]> = [
      [ArtifactType.ARCHITECTURE_SPEC, NodeType.RESEARCH],
      [ArtifactType.RESEARCH_DOSSIER, NodeType.PRD_REVIEWER],
      [ArtifactType.APPROVED_PRD, NodeType.PLANNER],
    ];
    for (const [artifact, next] of chain) {
      expect(HCR_TRANSITION_MAP[artifact]?.nextNodes).toEqual([next]);
    }
    // Producer-consumer continuity: each node's input is the previous output.
    expect(
      AGENT_REGISTRY[NodeType.RESEARCH]?.consumedArtifactTypes,
    ).toEqual([ArtifactType.ARCHITECTURE_SPEC]);
    expect(
      AGENT_REGISTRY[NodeType.PRD_REVIEWER]?.consumedArtifactTypes,
    ).toEqual([ArtifactType.RESEARCH_DOSSIER]);
    expect(
      AGENT_REGISTRY[NodeType.PLANNER]?.consumedArtifactTypes,
    ).toEqual([ArtifactType.APPROVED_PRD]);
    expect(
      AGENT_REGISTRY[NodeType.FRONTEND_ENG]?.consumedArtifactTypes,
    ).toEqual([ArtifactType.EXECUTION_PLAN]);
    expect(
      AGENT_REGISTRY[NodeType.BACKEND_ENG]?.consumedArtifactTypes,
    ).toEqual([ArtifactType.EXECUTION_PLAN]);
  });

  test("terminal nodes produce no artifact type (finalize path)", () => {
    // FE/BE send outputArtifactType:null, which the coordinator port maps to
    // the wait/finalize branch — no transition-map entry must exist for null.
    expect(
      HCR_TRANSITION_MAP[ArtifactType.EXECUTION_PLAN]?.nextNodes,
    ).toContain(NodeType.FRONTEND_ENG);
    // The registry follows the budget module rather than pinning a literal,
    // so the ceiling can change without this parity test going stale.
    expect(AGENT_REGISTRY[NodeType.FRONTEND_ENG]?.maxIterations).toBe(
      resolveNodeBudget("tool_calls").maxIterations,
    );
    expect(AGENT_REGISTRY[NodeType.BACKEND_ENG]?.maxIterations).toBe(
      resolveNodeBudget("tool_calls").maxIterations,
    );
    // A tool node writes roughly one file per turn, so the default ceiling
    // must be large enough for a realistic multi-file project.
    expect(DEFAULT_TOOL_NODE_ITERATIONS).toBeGreaterThanOrEqual(60);
    expect(resolveNodeBudget("structured_json").maxIterations).toBe(1);
  });
});
