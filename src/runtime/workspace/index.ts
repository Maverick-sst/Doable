import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { prisma } from "@/lib/prisma";

const EXCLUDED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".doable",
  ".turbo",
  "coverage",
]);

const EXCLUDED_FILES = new Set([".env", ".env.local", ".env.production"]);

export function getWorkspaceRoot(): string {
  const configured = process.env.DOABLE_HOME;
  const root = configured
    ? path.resolve(configured)
    : path.join(process.cwd(), ".doable");
  return path.join(root, "projects");
}

export function getProjectRoot(projectId: string): string {
  return path.join(getWorkspaceRoot(), projectId);
}

export function normalizeWorkspacePath(relativePath: string): string {
  if (!relativePath || relativePath.includes("\0")) {
    throw new Error("Invalid file path");
  }
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized.split("/").some((segment) => segment === "..")) {
    throw new Error("Path traversal is not allowed");
  }
  return normalized;
}

function resolveInside(root: string, relativePath: string): string {
  const normalized = normalizeWorkspacePath(relativePath);
  const resolved = path.resolve(root, normalized);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes the project workspace");
  }
  return resolved;
}

async function assertNoSymlinkEscape(root: string, target: string) {
  const rootReal = await realpath(root);
  let cursor = path.dirname(target);
  while (cursor.length >= root.length) {
    try {
      const real = await realpath(cursor);
      if (real !== rootReal && !real.startsWith(`${rootReal}${path.sep}`)) {
        throw new Error("Symlink escapes the project workspace");
      }
      break;
    } catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
}

export function checksum(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function ensureProjectWorkspace(projectId: string) {
  const root = getProjectRoot(projectId);
  await mkdir(root, { recursive: true });
  return root;
}

export interface WorkspaceWriteResult {
  path: string;
  absolutePath: string;
  checksum: string;
  size: number;
}

/**
 * Atomic write: the file is staged in the same directory and renamed into
 * place, so a crash cannot leave a half-written generated file.
 */
export async function writeWorkspaceFile(
  projectId: string,
  relativePath: string,
  content: string,
): Promise<WorkspaceWriteResult> {
  const root = await ensureProjectWorkspace(projectId);
  const target = resolveInside(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await assertNoSymlinkEscape(root, target);

  const temp = `${target}.tmp-${randomUUID()}`;
  await writeFile(temp, content, "utf8");
  await rename(temp, target);

  return {
    path: normalizeWorkspacePath(relativePath),
    absolutePath: target,
    checksum: checksum(content),
    size: Buffer.byteLength(content),
  };
}

export async function readWorkspaceFile(
  projectId: string,
  relativePath: string,
): Promise<string | null> {
  const root = getProjectRoot(projectId);
  const target = resolveInside(root, relativePath);
  try {
    return await readFile(target, "utf8");
  } catch {
    return null;
  }
}

export async function deleteWorkspaceFile(
  projectId: string,
  relativePath: string,
): Promise<void> {
  const root = getProjectRoot(projectId);
  const target = resolveInside(root, relativePath);
  await rm(target, { force: true });
}

async function walk(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (EXCLUDED_SEGMENTS.has(entry.name) || EXCLUDED_FILES.has(entry.name)) {
      continue;
    }
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(root, absolute)));
    } else if (entry.isFile()) {
      files.push(path.relative(root, absolute).replaceAll("\\", "/"));
    }
  }
  return files;
}

export async function listWorkspaceFiles(projectId: string): Promise<string[]> {
  const root = getProjectRoot(projectId);
  try {
    return await walk(root);
  } catch {
    return [];
  }
}

/**
 * One-way reconciliation for projects created before the workspace existed:
 * DB files are copied into the workspace if missing or stale. The DB remains
 * a mirror/metadata index; the workspace is the canonical editable copy.
 */
export async function syncProjectWorkspace(projectId: string) {
  const root = await ensureProjectWorkspace(projectId);
  const files = await prisma.file.findMany({
    where: { projectId },
    select: { id: true, path: true, content: true, checksum: true },
  });

  for (const file of files) {
    const target = resolveInside(root, file.path);
    let needsWrite = true;
    try {
      const existing = await readFile(target);
      needsWrite = checksum(existing) !== checksum(file.content);
    } catch {
      needsWrite = true;
    }

    if (needsWrite) {
      const written = await writeWorkspaceFile(projectId, file.path, file.content);
      await prisma.file.update({
        where: { id: file.id },
        data: {
          checksum: written.checksum,
          size: written.size,
          embeddingStatus: "EMBEDDING_PENDING",
        },
      });
    }
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { workspacePath: `projects/${projectId}` },
  });

  return { root, fileCount: files.length };
}

export async function exportProjectZip(projectId: string): Promise<Uint8Array> {
  const root = getProjectRoot(projectId);
  await syncProjectWorkspace(projectId);
  const files = await walk(root);
  const archive: Record<string, Uint8Array> = {};

  for (const relative of files) {
    if (relative.endsWith(".zip")) continue;
    const absolute = resolveInside(root, relative);
    const data = await readFile(absolute);
    archive[relative] = new Uint8Array(data);
  }

  // A tiny manifest makes exports self-describing without leaking secrets.
  archive["doable-export.json"] = strToU8(
    JSON.stringify(
      {
        projectId,
        exportedAt: new Date().toISOString(),
        fileCount: files.length,
        format: 1,
      },
      null,
      2,
    ),
  );

  return zipSync(archive, { level: 6 });
}

export async function workspaceStats(projectId: string) {
  const root = getProjectRoot(projectId);
  try {
    const info = await stat(root);
    const files = await listWorkspaceFiles(projectId);
    return { exists: true, updatedAt: info.mtime, fileCount: files.length };
  } catch {
    return { exists: false, updatedAt: null, fileCount: 0 };
  }
}

export async function workspaceFileExists(
  projectId: string,
  relativePath: string,
): Promise<boolean> {
  try {
    await access(resolveInside(getProjectRoot(projectId), relativePath));
    return true;
  } catch {
    return false;
  }
}