/**
 * Local integration smoke test. Requires a migrated disposable Postgres.
 *
 *   DATABASE_URL=postgresql://doable:doable@127.0.0.1:5432/doable \
 *   bun scripts/verify-local.ts
 *
 * It creates one project, exercises artifact revisions, the one-active-build
 * lock, failure transition, workspace writes, and ZIP export, then deletes the
 * project. It does not call a model or Temporal.
 */
import { ArtifactType, NodeType, ProjectStatus, WorkflowType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/src/auth";
import { createArtifact } from "@/src/runtime/artifacts/create-artifact";
import { startHcrRun } from "@/src/runtime/workflows/hcr/start-hcr-workflow";
import {
  cancelExecution,
  completeExecution,
  failExecution,
} from "@/src/runtime/state/transitions";
import { createProjectFile } from "@/src/runtime/files";
import {
  exportProjectZip,
  readWorkspaceFile,
} from "@/src/runtime/workspace";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main() {
  const user = await getCurrentUser();
  assert(user, "local user exists");

  // Remove stale fixtures from interrupted runs.
  await prisma.project.deleteMany({ where: { name: "integration-smoke" } });

  const project = await prisma.project.create({
    data: {
      name: "integration-smoke",
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

  const discoveryNode = await prisma.node.create({
    data: {
      executionId: (
        await prisma.execution.create({
          data: { workflowId: discoveryWorkflow.id, status: "COMPLETED" },
        })
      ).id,
      type: NodeType.DISCOVERY,
      status: "COMPLETED",
      order: 1,
    },
  });

  const discovery = await createArtifact({
    projectId: project.id,
    workflowId: discoveryWorkflow.id,
    nodeId: discoveryNode.id,
    type: ArtifactType.DISCOVERY_REQUIREMENT,
    producedBy: NodeType.DISCOVERY,
    content: {
      projectIntent: {
        summary: "integration smoke",
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
      confidenceScore: 0.8,
    },
  });
  assert(discovery.version === 1, "first artifact is version 1");

  const secondWorkflow = await prisma.workflow.create({
    data: { projectId: project.id, type: WorkflowType.HCR, status: "CREATED" },
  });
  const secondNode = await prisma.node.create({
    data: {
      executionId: (
        await prisma.execution.create({
          data: { workflowId: secondWorkflow.id, status: "CREATED" },
        })
      ).id,
      type: NodeType.ARCHITECT,
      status: "CREATED",
      order: 1,
    },
  });
  const second = await createArtifact({
    projectId: project.id,
    workflowId: secondWorkflow.id,
    nodeId: secondNode.id,
    type: ArtifactType.DISCOVERY_REQUIREMENT,
    producedBy: NodeType.ARCHITECT,
    content: {
      projectIntent: {
        summary: "second revision",
        domain: "FULL_STACK_APPLICATION",
        projectType: "Full Stack App",
      },
      coreFeatures: ["files", "second"],
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
  assert(second.version === 2, "second artifact is project-wide version 2");

  const latest = await prisma.artifact.findFirst({
    where: { projectId: project.id, type: ArtifactType.DISCOVERY_REQUIREMENT },
    orderBy: { version: "desc" },
  });
  assert(latest?.id === second.id, "latest retrieval returns the newest revision");

  await prisma.project.update({
    where: { id: project.id },
    data: { status: ProjectStatus.PENDING },
  });

  const run = await startHcrRun({
    projectId: project.id,
    userId: user.id,
    prompt: "integration build",
  });
  assert(run.nodeId, "build run created an architect node");

  let locked = false;
  try {
    await startHcrRun({
      projectId: project.id,
      userId: user.id,
      prompt: "duplicate build",
    });
  } catch {
    locked = true;
  }
  assert(locked, "second concurrent build is rejected");

  await failExecution({
    projectId: project.id,
    workflowId: run.workflowId,
    executionId: run.executionId,
    nodeId: run.nodeId,
    reason: "integration failure drill",
    code: "unknown",
  });
  const failedProject = await prisma.project.findUnique({
    where: { id: project.id },
    select: { status: true, failureReason: true },
  });
  assert(failedProject?.status === ProjectStatus.FAILED, "failure sets project FAILED");
  assert(failedProject?.failureReason, "failure reason is persisted");

  // Recovery path: reopen, start a second attempt, cancel it, and prove a
  // late completion cannot resurrect the cancelled run.
  await prisma.project.update({
    where: { id: project.id },
    data: { status: ProjectStatus.PENDING },
  });
  const retry = await startHcrRun({
    projectId: project.id,
    userId: user.id,
    prompt: "retry after failure",
  });
  await cancelExecution({
    projectId: project.id,
    workflowId: retry.workflowId,
    executionId: retry.executionId,
    reason: "integration cancel drill",
  });
  const cancelled = await prisma.execution.findUnique({
    where: { id: retry.executionId },
    select: { status: true },
  });
  assert(cancelled?.status === "CANCELLED", "cancel marks execution CANCELLED");

  const late = await completeExecution({
    projectId: project.id,
    workflowId: retry.workflowId,
    executionId: retry.executionId,
  });
  assert(late.transitioned === false, "late completion is rejected");
  const afterCancel = await prisma.project.findUnique({
    where: { id: project.id },
    select: { status: true },
  });
  assert(afterCancel?.status === ProjectStatus.IDLE, "cancelled project returns to IDLE");

  const file = await createProjectFile({
    projectId: project.id,
    path: "src/index.ts",
    content: "export const answer = 42;\n",
  });
  assert(file.path === "src/index.ts", "file metadata created");

  const workspaceContent = await readWorkspaceFile(project.id, "src/index.ts");
  assert(workspaceContent?.includes("answer = 42"), "workspace file is canonical");

  const zip = await exportProjectZip(project.id);
  assert(zip.byteLength > 0, "ZIP export produces bytes");

  await prisma.project.delete({ where: { id: project.id } });

  console.log("Local integration smoke: PASS");
  console.log(
    JSON.stringify(
      {
        artifactVersions: [discovery.version, second.version],
        latestArtifactId: latest.id,
        duplicateBuildRejected: locked,
        projectFailureState: failedProject.status,
        cancelDrill: cancelled.status,
        lateCompletionRejected: !late.transitioned,
        workspaceBytes: workspaceContent?.length,
        zipBytes: zip.byteLength,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(
      "Local integration smoke: FAIL",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });