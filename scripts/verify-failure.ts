/**
 * Failure attribution drill. Run the mock provider with MOCK_FAIL_NODE=PLANNER
 * and assert the workflow fails on PLANNER without also marking ARCHITECT
 * failed.
 */
import {
  ArtifactType,
  NodeStatus,
  NodeType,
  ProjectStatus,
  WorkflowType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/src/auth";
import { createArtifact } from "@/src/runtime/artifacts/create-artifact";
import { startBuild } from "@/src/temporal/runtime";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main() {
  const user = await getCurrentUser();
  assert(user, "local user exists");

  // Remove stale fixtures from interrupted runs.
  await prisma.project.deleteMany({ where: { name: "temporal-failure-smoke" } });

  const project = await prisma.project.create({
    data: {
      name: "temporal-failure-smoke",
      userId: user.id,
      status: ProjectStatus.DISCOVERY,
    },
  });
  await prisma.projectMemory.create({
    data: {
      projectId: project.id,
      domain: "FULL_STACK_APPLICATION",
      requirements: {},
      techStack: {},
      summary: "",
    },
  });

  const discoveryWorkflow = await prisma.workflow.create({
    data: { projectId: project.id, type: WorkflowType.DISCOVERY, status: "COMPLETED" },
  });
  const discoveryExecution = await prisma.execution.create({
    data: { workflowId: discoveryWorkflow.id, status: "COMPLETED" },
  });
  const discoveryNode = await prisma.node.create({
    data: {
      executionId: discoveryExecution.id,
      type: NodeType.DISCOVERY,
      status: "COMPLETED",
      order: 1,
    },
  });

  await createArtifact({
    projectId: project.id,
    workflowId: discoveryWorkflow.id,
    executionId: discoveryExecution.id,
    nodeId: discoveryNode.id,
    type: ArtifactType.DISCOVERY_REQUIREMENT,
    producedBy: NodeType.DISCOVERY,
    content: {
      projectIntent: {
        summary: "failure attribution drill",
        domain: "FULL_STACK_APPLICATION",
        projectType: "Full Stack App",
      },
      coreFeatures: ["demo"],
      userFlows: [],
      constraints: { technical: [], product: [], business: [] },
      techStack: {},
      dataEntities: [],
      authRequirements: [],
      integrations: [],
      assumptions: [],
      knownAmbiguities: [],
      confidenceScore: 0.9,
    },
  });

  await prisma.project.update({
    where: { id: project.id },
    data: { status: ProjectStatus.PENDING },
  });

  const run = await startBuild({
    projectId: project.id,
    userId: user.id,
    prompt: "Build until PLANNER fails",
  });

  const deadline = Date.now() + 120_000;
  let status: ProjectStatus = ProjectStatus.PENDING;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const current = await prisma.project.findUnique({
      where: { id: project.id },
      select: { status: true },
    });
    if (!current) throw new Error("Project disappeared");
    status = current.status;
    if (status === ProjectStatus.FAILED) break;
    if (status === ProjectStatus.IDLE) {
      throw new Error("Expected the build to fail on PLANNER");
    }
  }

  assert(status === ProjectStatus.FAILED, "project is FAILED");

  const nodes = await prisma.node.findMany({
    where: { executionId: run.executionId },
    select: { id: true, type: true, status: true },
  });
  const architect = nodes.find((node) => node.type === NodeType.ARCHITECT);
  const planner = nodes.find((node) => node.type === NodeType.PLANNER);

  assert(architect, "ARCHITECT node exists");
  assert(planner, "PLANNER node exists");
  assert(
    architect.status === NodeStatus.COMPLETED,
    "ARCHITECT remains COMPLETED (no double compensation)",
  );
  assert(planner.status === NodeStatus.FAILED, "PLANNER is FAILED");

  const failureEvents = await prisma.runtimeEvent.findMany({
    where: { executionId: run.executionId, type: "node.failed" },
    select: { nodeId: true },
  });
  assert(
    failureEvents.length === 1 && failureEvents[0]?.nodeId === planner.id,
    "exactly the PLANNER node.failed event exists",
  );

  const execution = await prisma.execution.findUnique({
    where: { id: run.executionId },
    select: { status: true },
  });
  assert(execution?.status === "FAILED", "execution is FAILED");

  const summary = {
    projectStatus: status,
    architect: architect.status,
    planner: planner.status,
    failureEvents: failureEvents.length,
    executionStatus: execution?.status,
  };

  await prisma.project.delete({ where: { id: project.id } });
  console.log("Temporal failure attribution smoke: PASS");
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(
      "Temporal failure attribution smoke: FAIL",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });