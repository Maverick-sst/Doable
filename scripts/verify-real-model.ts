/**
 * Real-model full-graph smoke test. Unlike verify-temporal.ts this does not
 * assert exact file paths, because a real model chooses its own structure.
 *
 *   MODEL_PROVIDER=runanywhere MODEL=glm-5.3-flash \
 *   DATABASE_URL=postgresql://doable:doable@127.0.0.1:5432/doable \
 *   bun scripts/verify-real-model.ts
 */
import {
  ArtifactType,
  NodeType,
  ProjectStatus,
  WorkflowType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/src/auth";
import { getProviderCapabilities, getProviderId } from "@/src/providers";
import { createArtifact } from "@/src/runtime/artifacts/create-artifact";
import { startBuild } from "@/src/temporal/runtime";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main() {
  const user = await getCurrentUser();
  assert(user, "local user exists");

  await prisma.project.deleteMany({ where: { name: "real-model-smoke" } });

  const project = await prisma.project.create({
    data: {
      name: "real-model-smoke",
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
        summary:
          "A minimal single-page notes app: one page, a textarea, and a list of notes kept in memory.",
        domain: "FULL_STACK_APPLICATION",
        projectType: "Full Stack App",
      },
      coreFeatures: ["add a note", "list notes"],
      userFlows: ["type a note, press add, see it in the list"],
      constraints: {
        technical: ["React + Vite + Tailwind", "no database required"],
        product: ["single page", "no authentication"],
        business: [],
      },
      techStack: {
        frontend: "React + Vite + Tailwind",
        backend: "none",
        database: "none",
        auth: "none",
      },
      dataEntities: ["Note"],
      authRequirements: [],
      integrations: [],
      assumptions: ["in-memory state is acceptable"],
      knownAmbiguities: [],
      confidenceScore: 0.9,
    },
  });

  await prisma.project.update({
    where: { id: project.id },
    data: { status: ProjectStatus.PENDING },
  });

  console.log(
    JSON.stringify(
      {
        provider: getProviderId(),
        capabilities: getProviderCapabilities(),
        projectId: project.id,
      },
      null,
      2,
    ),
  );

  const started = Date.now();
  const run = await startBuild({
    projectId: project.id,
    userId: user.id,
    prompt:
      "Build the notes app exactly as described in the approved requirements. Keep it small: a runnable Vite + React + Tailwind project.",
  });
  console.log(`Started ${run.temporalWorkflowId}`);

  const deadline = Date.now() + 25 * 60 * 1000;
  let status: ProjectStatus = ProjectStatus.PENDING;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const current = await prisma.project.findUnique({
      where: { id: project.id },
      select: { status: true, failureReason: true },
    });
    if (!current) throw new Error("Project disappeared");
    status = current.status;
    if (status === ProjectStatus.FAILED) {
      const nodes = await prisma.node.findMany({
        where: { execution: { workflowId: run.workflowId } },
        select: { type: true, status: true, failureReason: true },
      });
      throw new Error(
        `Build failed: ${current.failureReason ?? "unknown"} | nodes=${JSON.stringify(nodes)}`,
      );
    }
    if (status === ProjectStatus.IDLE) break;
    const nodes = await prisma.node.findMany({
      where: { execution: { workflowId: run.workflowId } },
      select: { type: true, status: true },
      orderBy: { order: "asc" },
    });
    console.log(
      `[${Math.round((Date.now() - started) / 1000)}s] ${status} :: ` +
        nodes.map((node) => `${node.type}:${node.status}`).join(" "),
    );
  }

  assert(status === ProjectStatus.IDLE, "project reached IDLE");

  const execution = await prisma.execution.findUnique({
    where: { id: run.executionId },
    include: { nodes: true, artifacts: true },
  });
  assert(execution, "execution exists");

  const files = await prisma.file.findMany({
    where: { projectId: project.id },
    select: { path: true, size: true },
    orderBy: { path: "asc" },
  });
  assert(files.length > 0, "at least one file was generated");

  const artifactTypes = execution.artifacts.map((artifact) => artifact.type);
  const nodeTypes = execution.nodes.map((node) => node.type);
  const events = await prisma.runtimeEvent.findMany({
    where: { executionId: run.executionId },
    select: { type: true },
  });

  const summary = {
    provider: getProviderId(),
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    projectStatus: status,
    executionStatus: execution.status,
    nodes: nodeTypes,
    artifacts: artifactTypes,
    files,
    eventTypes: Array.from(new Set(events.map((event) => event.type))).sort(),
    usageEvents: events.filter((event) => event.type === "model.usage").length,
  };

  console.log("Real-model HCR graph smoke: PASS");
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(
      "Real-model HCR graph smoke: FAIL",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });