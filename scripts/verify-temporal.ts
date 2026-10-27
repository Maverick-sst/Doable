/**
 * Full HCR graph smoke test against a running Temporal worker and the mock
 * provider (scripts/mock-provider.ts).
 *
 *   DATABASE_URL=postgresql://doable:doable@127.0.0.1:5432/doable \
 *   TEMPORAL_HOST=127.0.0.1:7233 \
 *   bun scripts/verify-temporal.ts
 */
import {
  ArtifactType,
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
  await prisma.project.deleteMany({ where: { name: "temporal-graph-smoke" } });

  const project = await prisma.project.create({
    data: {
      name: "temporal-graph-smoke",
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
      type: WorkflowType.DISCOVERY,
      status: "COMPLETED",
    },
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
        summary: "A tiny demo app for graph verification",
        domain: "FULL_STACK_APPLICATION",
        projectType: "Full Stack App",
      },
      coreFeatures: ["demo screen"],
      userFlows: [],
      constraints: { technical: [], product: [], business: [] },
      techStack: { frontend: "React", backend: "Node" },
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
    prompt: "Build the demo app",
  });

  const deadline = Date.now() + 180_000;
  let projectStatus: ProjectStatus = ProjectStatus.PENDING;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const current = await prisma.project.findUnique({
      where: { id: project.id },
      select: { status: true, failureReason: true },
    });
    if (!current) throw new Error("Project disappeared during the run");
    projectStatus = current.status;
    if (projectStatus === ProjectStatus.IDLE) break;
    if (projectStatus === ProjectStatus.FAILED) {
      throw new Error(`Build failed: ${current.failureReason ?? "unknown"}`);
    }
  }

  assert(projectStatus === ProjectStatus.IDLE, "project reaches IDLE");

  const execution = await prisma.execution.findUnique({
    where: { id: run.executionId },
    include: {
      workflow: true,
      nodes: { orderBy: { order: "asc" } },
      artifacts: true,
    },
  });
  assert(execution, "execution exists");
  assert(execution.status === "COMPLETED", "execution is COMPLETED");
  assert(execution.workflow.status === "COMPLETED", "workflow is COMPLETED");

  const nodeTypes = execution.nodes.map((node) => node.type);
  for (const expected of [
    NodeType.ARCHITECT,
    NodeType.RESEARCH,
    NodeType.PRD_REVIEWER,
    NodeType.PLANNER,
    NodeType.FRONTEND_ENG,
    NodeType.BACKEND_ENG,
  ]) {
    assert(nodeTypes.includes(expected), `node ${expected} exists`);
  }

  for (const node of execution.nodes) {
    assert(
      node.agentConfigVersion !== null,
      `node ${node.type} records its agent config version`,
    );
    assert(
      node.agentConfigHash?.startsWith("sha256:") ?? false,
      `node ${node.type} records its agent config hash`,
    );
  }

  const artifactTypes = execution.artifacts.map((artifact) => artifact.type);
  for (const expected of [
    ArtifactType.ARCHITECTURE_SPEC,
    ArtifactType.RESEARCH_DOSSIER,
    ArtifactType.APPROVED_PRD,
    ArtifactType.EXECUTION_PLAN,
  ]) {
    assert(artifactTypes.includes(expected), `artifact ${expected} exists`);
  }

  const files = await prisma.file.findMany({
    where: { projectId: project.id },
    select: { path: true },
  });
  assert(
    files.some((file) => file.path === "src/App.tsx"),
    "frontend file exists",
  );
  assert(
    files.some((file) => file.path === "server/index.ts"),
    "backend file exists",
  );

  const events = await prisma.runtimeEvent.findMany({
    where: { executionId: run.executionId },
    select: { type: true, payload: true },
  });
  assert(
    events.some((event) => event.type === "workflow.completed"),
    "workflow.completed event exists",
  );

  const contextEvents = events.filter(
    (event) => event.type === "context.assembled",
  );
  assert(contextEvents.length >= 6, "every node assembled context with provenance");
  for (const event of contextEvents) {
    const payload = event.payload as { fingerprint?: unknown } | null;
    assert(
      typeof payload?.fingerprint === "string" &&
        payload.fingerprint.startsWith("sha256:"),
      "context.assembled carries a reproducibility fingerprint",
    );
  }

  // Memory curation starts after finalize as its own workflow; wait for its
  // first pass so the drill proves the wiring, not just the scheduler call.
  let memoryEntries = 0;
  const memoryDeadline = Date.now() + 60_000;
  while (Date.now() < memoryDeadline) {
    memoryEntries = await prisma.memoryEntry.count({
      where: { projectId: project.id },
    });
    if (memoryEntries > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  assert(memoryEntries > 0, "memory curation created entries after finalize");

  const summary = {
    projectId: project.id,
    memoryEntries,
    temporalWorkflowId: run.temporalWorkflowId,
    nodes: nodeTypes,
    artifacts: artifactTypes,
    files: files.map((file) => file.path),
    eventCount: events.length,
  };

  await prisma.project.delete({ where: { id: project.id } });

  console.log("Temporal HCR graph smoke: PASS");
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(
      "Temporal HCR graph smoke: FAIL",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });