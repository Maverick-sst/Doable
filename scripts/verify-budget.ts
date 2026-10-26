/**
 * Budget exhaustion drill.
 *
 * The mock provider never calls mark_complete, so the tool node must stop on
 * its budget. The expected outcome is an INCOMPLETE node and a PARTIAL
 * attempt that keeps the produced files, never a FAILED run.
 *
 *   NODE_MAX_ITERATIONS=3 bun scripts/verify-budget.ts
 */
import { ExecutionStatus, NodeStatus, NodeType, ProjectStatus } from "@prisma/client";
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

  await prisma.project.deleteMany({ where: { name: "budget-smoke" } });

  const project = await prisma.project.create({
    data: {
      name: "budget-smoke",
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
    data: {
      projectId: project.id,
      type: "DISCOVERY",
      status: "COMPLETED",
    },
  });
  const discoveryExecution = await prisma.execution.create({
    data: { workflowId: discoveryWorkflow.id, status: "COMPLETED" },
  });
  const discoveryNode = await prisma.node.create({
    data: {
      executionId: discoveryExecution.id,
      type: "DISCOVERY",
      status: "COMPLETED",
      order: 1,
    },
  });

  await createArtifact({
    projectId: project.id,
    workflowId: discoveryWorkflow.id,
    executionId: discoveryExecution.id,
    nodeId: discoveryNode.id,
    type: "DISCOVERY_REQUIREMENT",
    producedBy: "DISCOVERY",
    content: {
      projectIntent: {
        summary: "budget drill",
        domain: "FULL_STACK_APPLICATION",
        projectType: "Full Stack App",
      },
      coreFeatures: ["files"],
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
    prompt: "Build enough files to exhaust the budget",
  });

  const deadline = Date.now() + 240_000;
  let status: ProjectStatus = ProjectStatus.PENDING;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const current = await prisma.project.findUnique({
      where: { id: project.id },
      select: { status: true, failureReason: true },
    });
    if (!current) throw new Error("Project disappeared");
    status = current.status;
    if (status !== ProjectStatus.PENDING && status !== ProjectStatus.IN_PROGRESS) {
      break;
    }
  }

  const execution = await prisma.execution.findUnique({
    where: { id: run.executionId },
    include: { nodes: true },
  });
  assert(execution, "execution exists");

  const toolNodeTypes: NodeType[] = [
    NodeType.FRONTEND_ENG,
    NodeType.BACKEND_ENG,
  ];
  const toolNodes = execution.nodes.filter((node) =>
    toolNodeTypes.includes(node.type),
  );
  assert(toolNodes.length > 0, "a tool node ran");

  const incomplete = toolNodes.filter(
    (node) => node.status === NodeStatus.INCOMPLETE,
  );
  assert(
    incomplete.length > 0,
    `expected an INCOMPLETE tool node, got ${JSON.stringify(toolNodes.map((n) => [n.type, n.status]))}`,
  );
  assert(
    toolNodes.every((node) => node.status !== NodeStatus.FAILED),
    "a budget stop is not reported as FAILED",
  );

  assert(
    execution.status === ExecutionStatus.PARTIAL,
    `execution status is PARTIAL, got ${execution.status}`,
  );
  assert(
    execution.completionStatus === "PARTIAL",
    `execution completionStatus is PARTIAL, got ${execution.completionStatus}`,
  );
  assert(
    status === ProjectStatus.INCOMPLETE,
    `project status is INCOMPLETE, got ${status}`,
  );

  const budgetEvents = await prisma.runtimeEvent.findMany({
    where: { executionId: run.executionId, type: "node.budget_exhausted" },
    select: { nodeId: true, payload: true },
  });
  assert(budgetEvents.length > 0, "node.budget_exhausted event recorded");

  const files = await prisma.file.findMany({
    where: { projectId: project.id },
    select: { path: true },
  });
  assert(files.length > 0, "produced files are preserved");

  const summary = {
    projectStatus: status,
    executionStatus: execution.status,
    completionStatus: execution.completionStatus,
    toolNodes: toolNodes.map((node) => `${node.type}:${node.status}`),
    budgetEvents: budgetEvents.length,
    preservedFiles: files.length,
  };

  await prisma.project.delete({ where: { id: project.id } });

  console.log("Budget exhaustion smoke: PASS");
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(
      "Budget exhaustion smoke: FAIL",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
