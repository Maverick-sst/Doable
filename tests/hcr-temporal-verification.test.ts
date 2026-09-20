import { describe, expect, test } from "bun:test";
import { ArtifactType, NodeType } from "@prisma/client";
import {
  buildHcrWorkflowId,
  isHcrDomainFailure,
} from "@/src/temporal/contracts/hcr";
import { AGENT_REGISTRY } from "@/src/cognition/agent-registry";
import { HCR_TRANSITION_MAP } from "@/src/runtime/workflows/hcr/transition-map";

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
