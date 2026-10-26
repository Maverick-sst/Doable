/**
 * Resume drill.
 *
 * The mock provider fails the first PLANNER attempt only. The build must then
 * resume at PLANNER, reuse the artifacts produced before the failure, and
 * finish without regenerating the upstream artifacts.
 *
 *   MOCK_FAIL_NODE=PLANNER MOCK_FAIL_ONCE=1 bun scripts/verify-resume.ts
 */
import {
  ArtifactType,
  ExecutionStatus,
  NodeType,
  ProjectStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/src/auth";
import { createArtifact } from "@/src/runtime/artifacts/create-artifact";
import {
  findResumeTarget,
} from "@/src/runtime/workflows/hcr/resume-hcr-run";
import {
  retryOrResumeBuild,
  startBuild,
} from "@/src/temporal/runtime";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function artifactVersions(projectId: string) {
  const rows = await prisma.artifact.findMany({
    where: { projectId },
    select: { type: true, version: true, id: true },
    orderBy: [{ type: "asc" }, { version: "asc" }],
  });
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.type, row.version);
  }
  return { map, rows };
}

async function main() {
  const user = await getCurrentUser();
  assert(user, "local user exists");

  await prisma.project.deleteMany({ where: { name: "resume-smoke" } });

  const project = await prisma.project.create({
    data: {
      name: "resume-smoke",
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
    type: ArtifactType.DISCOVERY_REQUIREMENT,
    producedBy: NodeType.DISCOVERY,
    content: {
      projectIntent: {
        summary: "resume drill",
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

  // Attempt 1 fails at PLANNER.
  const first = await startBuild({
    projectId: project.id,
    userId: user.id,
    prompt: "Build the demo project",
  });

  const failDeadline = Date.now() + 180_000;
  while (Date.now() < failDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const current = await prisma.project.findUnique({
      where: { id: project.id },
      select: { status: true },
    });
    if (current?.status === ProjectStatus.FAILED) break;
    if (current?.status === ProjectStatus.IDLE) {
      throw new Error("Expected the first attempt to fail at PLANNER");
    }
  }

  const failedExecution = await prisma.execution.findUnique({
    where: { id: first.executionId },
    select: { status: true, attempt: true },
  });
  assert(
    failedExecution?.status === ExecutionStatus.FAILED,
    `first attempt is FAILED, got ${failedExecution?.status}`,
  );

  const afterFailure = await artifactVersions(project.id);
  assert(
    afterFailure.map.get(ArtifactType.ARCHITECTURE_SPEC) === 1,
    "ARCHITECTURE_SPEC v1 exists",
  );
  assert(
    afterFailure.map.get(ArtifactType.RESEARCH_DOSSIER) === 1,
    "RESEARCH_DOSSIER v1 exists",
  );
  assert(
    afterFailure.map.get(ArtifactType.APPROVED_PRD) === 1,
    "APPROVED_PRD v1 exists",
  );
  assert(
    afterFailure.map.get(ArtifactType.EXECUTION_PLAN) === undefined,
    "PLANNER produced no EXECUTION_PLAN",
  );

  // The resume target must be the node that failed.
  const target = await findResumeTarget(project.id);
  assert(target, "a resume target exists");
  assert(
    target.nodeType === NodeType.PLANNER,
    `resume target is PLANNER, got ${target.nodeType}`,
  );
  assert(target.order === 4, `resume target order is 4, got ${target.order}`);

  // Attempt 2 resumes.
  const second = await retryOrResumeBuild({
    projectId: project.id,
    userId: user.id,
    prompt: "Build the demo project",
  });
  assert(second.resumed, "the retry resumed instead of starting over");
  assert(second.attempt === 2, `attempt number is 2, got ${second.attempt}`);
  assert(
    second.executionId !== first.executionId,
    "the resumed attempt is a new execution",
  );
  assert(
    second.workflowId === first.workflowId,
    "the resumed attempt stays in the same build",
  );

  const resumedExecution = await prisma.execution.findUnique({
    where: { id: second.executionId },
    select: {
      attempt: true,
      parentExecutionId: true,
      resumedFromNodeType: true,
      status: true,
    },
  });
  assert(resumedExecution?.attempt === 2, "execution attempt is 2");
  assert(
    resumedExecution?.parentExecutionId === first.executionId,
    "execution links to the attempt it resumes",
  );
  assert(
    resumedExecution?.resumedFromNodeType === NodeType.PLANNER,
    "execution records the resume position",
  );

  const doneDeadline = Date.now() + 300_000;
  while (Date.now() < doneDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const current = await prisma.project.findUnique({
      where: { id: project.id },
      select: { status: true },
    });
    if (current?.status === ProjectStatus.IDLE) break;
    if (current?.status === ProjectStatus.FAILED) {
      throw new Error("The resumed attempt failed");
    }
  }

  const finalStatus = await prisma.project.findUnique({
    where: { id: project.id },
    select: { status: true },
  });
  assert(
    finalStatus?.status === ProjectStatus.IDLE,
    `project reached IDLE, got ${finalStatus?.status}`,
  );

  const afterResume = await artifactVersions(project.id);
  assert(
    afterResume.map.get(ArtifactType.ARCHITECTURE_SPEC) === 1,
    "ARCHITECTURE_SPEC was NOT regenerated (still v1)",
  );
  assert(
    afterResume.map.get(ArtifactType.RESEARCH_DOSSIER) === 1,
    "RESEARCH_DOSSIER was NOT regenerated (still v1)",
  );
  assert(
    afterResume.map.get(ArtifactType.APPROVED_PRD) === 1,
    "APPROVED_PRD was NOT regenerated (still v1)",
  );
  assert(
    afterResume.map.get(ArtifactType.EXECUTION_PLAN) === 1,
    "EXECUTION_PLAN was produced by the resumed PLANNER",
  );

  const upstreamTypes: ArtifactType[] = [
    ArtifactType.ARCHITECTURE_SPEC,
    ArtifactType.RESEARCH_DOSSIER,
    ArtifactType.APPROVED_PRD,
  ];
  const firstNodeIds = afterFailure.rows
    .filter((row) => upstreamTypes.includes(row.type))
    .map((row) => row.id);
  const secondNodeIds = afterResume.rows
    .filter((row) => upstreamTypes.includes(row.type))
    .map((row) => row.id);
  assert(
    firstNodeIds.every((id) => secondNodeIds.includes(id)),
    "upstream artifact rows are the same records, not new ones",
  );

  const summary = {
    firstAttempt: {
      executionId: first.executionId,
      status: failedExecution?.status,
    },
    resumedAttempt: {
      executionId: second.executionId,
      attempt: second.attempt,
      resumed: second.resumed,
      resumedFrom: target.nodeType,
    },
    artifactsBefore: Object.fromEntries(afterFailure.map),
    artifactsAfter: Object.fromEntries(afterResume.map),
    projectStatus: finalStatus?.status,
  };

  await prisma.project.delete({ where: { id: project.id } });

  console.log("Resume smoke: PASS");
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(
      "Resume smoke: FAIL",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
