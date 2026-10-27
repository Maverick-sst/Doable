import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createBlob,
  createBranch,
  createCommit,
  createPullRequest,
  createTree,
  getBranchHead,
  getCommitTreeSha,
  getRepository,
  getTree,
  type GitHubTreeChange,
} from "./client";
import { GitHubError, asGitHubError } from "./errors";
import { resolveGitHubToken } from "./token-crypto";
import {
  buildWorkspaceManifest,
  planPush,
  planStats,
  type PushPlan,
  type WorkspaceManifest,
} from "./snapshot";

const BLOB_CONCURRENCY = 6;
const SAMPLE_LIMIT = 100;

type PushStats = {
  additions: number;
  updates: number;
  deletions: number;
  files: number;
  additionsSample: string[];
  updatesSample: string[];
  deletionsSample: string[];
  samplesTruncated: boolean;
  pullRequestCreated?: boolean;
};

function sample(paths: string[]): string[] {
  return paths.slice(0, SAMPLE_LIMIT);
}

function toStats(plan: PushPlan): PushStats {
  const counts = planStats(plan);
  return {
    ...counts,
    additionsSample: sample(plan.additions),
    updatesSample: sample(plan.updates),
    deletionsSample: sample(plan.deletions),
    samplesTruncated:
      plan.additions.length > SAMPLE_LIMIT ||
      plan.updates.length > SAMPLE_LIMIT ||
      plan.deletions.length > SAMPLE_LIMIT,
  };
}

function branchSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "project";
}

function newBranchName(projectName: string): string {
  return `doable/${branchSlug(projectName)}-${randomUUID().slice(0, 8)}`;
}

async function loadProjectContext(projectId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId, archivedAt: null },
    select: { id: true, name: true },
  });
  if (!project) {
    throw new GitHubError("not_found", "Project not found", 404);
  }
  const link = await prisma.projectGitHubLink.findUnique({
    where: { projectId },
    include: { connection: true },
  });
  if (!link) {
    throw new GitHubError(
      "not_configured",
      "Link this project to a GitHub repository first",
      409,
    );
  }
  const connection =
    link.connection ??
    (await prisma.gitHubConnection.findUnique({ where: { userId } }));
  const token = resolveGitHubToken(connection);
  return { project, link, connection, token };
}

async function baseState(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  defaultBranch: string,
) {
  let head: { sha: string };
  try {
    head = await getBranchHead(token, owner, repo, branch);
  } catch (error) {
    const safe = asGitHubError(error);
    if (safe.code === "not_found" && branch === defaultBranch) {
      throw new GitHubError(
        "empty_repository",
        "GitHub repository has no commits yet",
        409,
      );
    }
    throw error;
  }
  const treeSha = await getCommitTreeSha(token, owner, repo, head.sha);
  const base = await getTree(token, owner, repo, treeSha);
  return { head, base };
}

function ensurePushPermission(permissions?: {
  push?: boolean;
  admin?: boolean;
}): void {
  if (permissions && permissions.push === false && permissions.admin !== true) {
    throw new GitHubError(
      "forbidden",
      "GitHub token does not have push access to this repository",
      403,
    );
  }
}

export type PushPreview = {
  pushId: string;
  projectId: string;
  branch: string;
  baseBranch: string;
  baseSha: string;
  manifestHash: string;
  stats: PushStats;
  plan: PushPlan;
  expires: false;
};

export async function previewPush(input: {
  projectId: string;
  userId: string;
  baseBranch?: string;
}): Promise<PushPreview> {
  const { project, link, connection, token } = await loadProjectContext(
    input.projectId,
    input.userId,
  );
  const repo = await getRepository(token, link.owner, link.repo);
  ensurePushPermission(repo.permissions);
  const baseBranch = input.baseBranch ?? link.defaultBranch;
  const { head, base } = await baseState(
    token,
    link.owner,
    link.repo,
    baseBranch,
    repo.defaultBranch,
  );
  const manifest = await buildWorkspaceManifest(project.id);
  const plan = planPush(manifest, base, true);
  const stats = toStats(plan);
  const branch = newBranchName(project.name);

  const push = await prisma.$transaction(async (tx) => {
    await tx.gitHubPush.updateMany({
      where: { projectId: project.id, userId: input.userId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    return tx.gitHubPush.create({
      data: {
        projectId: project.id,
        userId: input.userId,
        connectionId: connection?.id ?? null,
        status: "PENDING",
        branch,
        baseBranch,
        baseSha: head.sha,
        manifestHash: manifest.manifestHash,
        stats: stats as unknown as Prisma.InputJsonValue,
      },
    });
  });

  return {
    pushId: push.id,
    projectId: project.id,
    branch,
    baseBranch,
    baseSha: head.sha,
    manifestHash: manifest.manifestHash,
    stats,
    plan,
    expires: false,
  };
}

export async function confirmPush(input: {
  pushId: string;
  projectId: string;
  userId: string;
  manifestHash: string;
  allowDeletions: boolean;
  createPullRequest: boolean;
}): Promise<{
  pushId: string;
  status: string;
  branch: string;
  commitSha: string;
  pullRequestUrl: string | null;
}> {
  const push = await prisma.gitHubPush.findFirst({
    where: {
      id: input.pushId,
      projectId: input.projectId,
      userId: input.userId,
      project: { archivedAt: null },
    },
    include: { project: { select: { name: true } } },
  });
  if (!push) {
    throw new GitHubError("not_found", "Push preview not found", 404);
  }
  if (push.status !== "PENDING") {
    throw new GitHubError(
      "push_not_pending",
      "This push preview is no longer pending",
      409,
    );
  }
  if (push.manifestHash !== input.manifestHash) {
    throw new GitHubError(
      "conflict",
      "The workspace changed after preview. Preview again.",
      409,
    );
  }

  const { link, connection, token } = await loadProjectContext(
    input.projectId,
    input.userId,
  );
  const manifest = await buildWorkspaceManifest(input.projectId);
  if (manifest.manifestHash !== push.manifestHash) {
    throw new GitHubError(
      "conflict",
      "The workspace changed after preview. Preview again.",
      409,
    );
  }

  const head = await getBranchHead(
    token,
    link.owner,
    link.repo,
    push.baseBranch,
  );
  if (head.sha !== push.baseSha) {
    throw new GitHubError(
      "push_base_moved",
      "The base branch moved after preview. Preview again.",
      409,
    );
  }

  const claimed = await prisma.gitHubPush.updateMany({
    where: { id: push.id, status: "PENDING" },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
  });
  if (claimed.count !== 1) {
    throw new GitHubError(
      "push_not_pending",
      "This push preview is no longer pending",
      409,
    );
  }

  try {
    const treeSha = await getCommitTreeSha(
      token,
      link.owner,
      link.repo,
      push.baseSha,
    );
    const base = await getTree(token, link.owner, link.repo, treeSha);
    const plan = planPush(manifest, base, input.allowDeletions);
    if (plan.additions.length === 0 && plan.updates.length === 0 && plan.deletions.length === 0) {
      throw new GitHubError("conflict", "There are no changes to push", 409);
    }

    const changes = await buildChanges(
      token,
      link.owner,
      link.repo,
      manifest,
      plan,
    );
    const newTreeSha = await createTree(
      token,
      link.owner,
      link.repo,
      treeSha,
      changes,
    );
    const commit = await createCommit(token, link.owner, link.repo, {
      message: `Doable: update ${push.project.name}`,
      tree: newTreeSha,
      parents: [push.baseSha],
    });
    await createBranch(
      token,
      link.owner,
      link.repo,
      push.branch,
      commit.sha,
    );

    let pullRequestUrl: string | null = null;
    let pullRequestNumber: number | null = null;
    if (input.createPullRequest) {
      try {
        const pullRequest = await createPullRequest(
          token,
          link.owner,
          link.repo,
          {
            title: `Doable: ${push.project.name}`,
            head: push.branch,
            base: push.baseBranch,
            body: "Generated by Doable from the project workspace.",
          },
        );
        pullRequestUrl = pullRequest.htmlUrl;
        pullRequestNumber = pullRequest.number;
      } catch {
        pullRequestUrl = null;
      }
    }

    const stats = toStats(plan);
    await prisma.gitHubPush.update({
      where: { id: push.id },
      data: {
        status: "COMPLETED",
        commitSha: commit.sha,
        pullRequestUrl,
        pullRequestNumber,
        stats: {
          ...stats,
          pullRequestCreated: pullRequestUrl !== null,
        } as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
        connectionId: connection?.id ?? null,
      },
    });

    return {
      pushId: push.id,
      status: "COMPLETED",
      branch: push.branch,
      commitSha: commit.sha,
      pullRequestUrl,
    };
  } catch (error) {
    const safe = asGitHubError(error);
    await prisma.gitHubPush.update({
      where: { id: push.id },
      data: {
        status: "FAILED",
        errorCode: safe.code,
        completedAt: new Date(),
      },
    });
    throw safe;
  }
}

async function buildChanges(
  token: string,
  owner: string,
  repo: string,
  manifest: WorkspaceManifest,
  plan: PushPlan,
): Promise<GitHubTreeChange[]> {
  const wanted = new Set([...plan.additions, ...plan.updates]);
  const files = manifest.files.filter((file) => wanted.has(file.path));
  const changes: GitHubTreeChange[] = [];
  for (let index = 0; index < files.length; index += BLOB_CONCURRENCY) {
    const batch = files.slice(index, index + BLOB_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (file) => ({
        path: file.path,
        sha: await createBlob(token, owner, repo, file.contentBase64),
      })),
    );
    changes.push(...results);
  }
  for (const path of plan.deletions) {
    changes.push({ path, sha: null });
  }
  return changes.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}

export async function cancelPush(input: {
  pushId: string;
  projectId: string;
  userId: string;
}): Promise<void> {
  const changed = await prisma.gitHubPush.updateMany({
    where: {
      id: input.pushId,
      projectId: input.projectId,
      userId: input.userId,
      status: "PENDING",
    },
    data: { status: "CANCELLED" },
  });
  if (changed.count !== 1) {
    throw new GitHubError(
      "push_not_pending",
      "This push preview is no longer pending",
      409,
    );
  }
}

export async function getPush(input: {
  pushId: string;
  projectId: string;
  userId: string;
}) {
  const push = await prisma.gitHubPush.findFirst({
    where: {
      id: input.pushId,
      projectId: input.projectId,
      userId: input.userId,
    },
  });
  if (!push) {
    throw new GitHubError("not_found", "Push not found", 404);
  }
  return push;
}

export async function listRecentPushes(
  projectId: string,
  userId: string,
  limit = 10,
) {
  const project = await prisma.project.count({
    where: { id: projectId, userId, archivedAt: null },
  });
  if (project === 0) {
    throw new GitHubError("not_found", "Project not found", 404);
  }
  return prisma.gitHubPush.findMany({
    where: { projectId, userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
  });
}
