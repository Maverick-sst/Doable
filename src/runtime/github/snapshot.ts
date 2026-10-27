import { createHash } from "node:crypto";
import { GitHubError } from "./errors";
import type { WorkspaceSnapshotFile } from "@/src/runtime/workspace";
import { readWorkspaceSnapshot } from "@/src/runtime/workspace";

export const MAX_FILE_BYTES = 1_048_576;
export const MAX_TOTAL_BYTES = 52_428_800;
export const MAX_FILES = 2_000;

export type SnapshotFile = {
  path: string;
  contentBase64: string;
  checksum: string;
  size: number;
  gitSha: string;
};

export type WorkspaceManifest = {
  files: SnapshotFile[];
  totalBytes: number;
  manifestHash: string;
};

function gitBlobSha(content: Buffer): string {
  return createHash("sha1")
    .update(`blob ${content.byteLength}\0`)
    .update(content)
    .digest("hex");
}

function comparePath(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function assertSafeFile(file: WorkspaceSnapshotFile): void {
  if (!file.path || file.path.startsWith("/") || file.path.includes("\0")) {
    throw new GitHubError("invalid_request", "Invalid workspace file path", 400);
  }
  if (file.path.split("/").some((segment) => segment === "..")) {
    throw new GitHubError("invalid_request", "Invalid workspace file path", 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new GitHubError(
      "push_limit_exceeded",
      `File exceeds the 1 MB push limit: ${file.path}`,
      413,
    );
  }
}

export function computeManifestHash(
  files: Array<{ path: string; checksum: string; size: number }>,
): string {
  const sorted = [...files].sort(comparePath);
  return createHash("sha256")
    .update(
      sorted
        .map((file) => `${file.path}\t${file.checksum}\t${file.size}`)
        .join("\n"),
    )
    .digest("hex");
}

export async function buildWorkspaceManifest(
  projectId: string,
): Promise<WorkspaceManifest> {
  const snapshot = await readWorkspaceSnapshot(projectId);
  if (snapshot.length > MAX_FILES) {
    throw new GitHubError(
      "push_limit_exceeded",
      `Workspace exceeds the ${MAX_FILES}-file push limit`,
      413,
    );
  }

  let totalBytes = 0;
  const files: SnapshotFile[] = [];
  for (const file of snapshot) {
    assertSafeFile(file);
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new GitHubError(
        "push_limit_exceeded",
        "Workspace exceeds the 50 MB push limit",
        413,
      );
    }
    files.push({
      path: file.path,
      contentBase64: file.content.toString("base64"),
      checksum: file.checksum,
      size: file.size,
      gitSha: gitBlobSha(file.content),
    });
  }

  return {
    files,
    totalBytes,
    manifestHash: computeManifestHash(files),
  };
}

export type PushPlan = {
  additions: string[];
  updates: string[];
  deletions: string[];
};

export function planPush(
  manifest: WorkspaceManifest,
  base: Array<{ path: string; sha: string }>,
  allowDeletions: boolean,
): PushPlan {
  const baseByPath = new Map(base.map((entry) => [entry.path, entry.sha]));
  const manifestPaths = new Set(manifest.files.map((file) => file.path));
  const additions: string[] = [];
  const updates: string[] = [];

  for (const file of manifest.files) {
    const remoteSha = baseByPath.get(file.path);
    if (remoteSha === undefined) {
      additions.push(file.path);
    } else if (file.gitSha !== remoteSha) {
      updates.push(file.path);
    }
  }

  const deletions = allowDeletions
    ? base
        .map((entry) => entry.path)
        .filter((path) => !manifestPaths.has(path))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    : [];

  return {
    additions: additions.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    updates: updates.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    deletions,
  };
}

export function planStats(plan: PushPlan): {
  additions: number;
  updates: number;
  deletions: number;
  files: number;
} {
  return {
    additions: plan.additions.length,
    updates: plan.updates.length,
    deletions: plan.deletions.length,
    files: plan.additions.length + plan.updates.length,
  };
}
