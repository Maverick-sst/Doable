import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { embedFileContent } from "@/src/runtime/embeddings";
import {
  deleteWorkspaceFile,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "@/src/runtime/workspace";

export class FileConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileConflictError";
  }
}

export class FileNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileNotFoundError";
  }
}

export interface ProjectFileRecord {
  id: string;
  path: string;
  content: string;
  size: number | null;
  revision: number;
  checksum: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The file seam: one interface for DB metadata, workspace bytes, and
 * optional embeddings. Callers never decide the write order themselves.
 */
export async function createProjectFile(input: {
  projectId: string;
  path: string;
  content: string;
}): Promise<ProjectFileRecord> {
  // Retried tool calls and repeated agent steps should not fail when the
  // requested file already exists with identical content.
  const existing = await prisma.file.findFirst({
    where: { projectId: input.projectId, path: input.path },
  });
  if (existing) {
    if (existing.content === input.content) {
      await writeWorkspaceFile(
        input.projectId,
        input.path,
        input.content,
      ).catch(() => undefined);
      return existing;
    }
    throw new FileConflictError(`A file already exists at ${input.path}`);
  }

  const file = await (async () => {
    try {
      return await prisma.file.create({
        data: {
          projectId: input.projectId,
          path: input.path,
          content: input.content,
          size: Buffer.byteLength(input.content),
          revision: 1,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const winner = await prisma.file.findFirst({
          where: { projectId: input.projectId, path: input.path },
        });
        if (winner?.content === input.content) return winner;
        throw new FileConflictError(`A file already exists at ${input.path}`);
      }
      throw error;
    }
  })();

  let writtenChecksum: string | null = null;
  let writtenSize = Buffer.byteLength(input.content);
  try {
    const written = await writeWorkspaceFile(
      input.projectId,
      input.path,
      input.content,
    );
    writtenChecksum = written.checksum;
    writtenSize = written.size;
    await prisma.file.update({
      where: { id: file.id },
      data: { checksum: written.checksum, size: written.size },
    });
  } catch (error) {
    // The workspace write failed; do not leave a DB-only phantom file.
    await prisma.file.delete({ where: { id: file.id } }).catch(() => undefined);
    throw error;
  }

  await embedFileContent({
    projectId: input.projectId,
    fileId: file.id,
    content: input.content,
  });

  return { ...file, checksum: writtenChecksum, size: writtenSize };
}

export async function updateProjectFile(input: {
  projectId: string;
  path: string;
  content: string;
}): Promise<ProjectFileRecord> {
  const existing = await prisma.file.findFirst({
    where: { projectId: input.projectId, path: input.path },
  });
  if (!existing) throw new FileNotFoundError(`File not found at ${input.path}`);

  const written = await writeWorkspaceFile(
    input.projectId,
    input.path,
    input.content,
  );
  const updated = await prisma.file.update({
    where: { projectId_path: { projectId: input.projectId, path: input.path } },
    data: {
      content: input.content,
      checksum: written.checksum,
      size: written.size,
      revision: { increment: 1 },
      embeddingStatus: "EMBEDDING_PENDING",
    },
  });

  await embedFileContent({
    projectId: input.projectId,
    fileId: updated.id,
    content: input.content,
  });

  return updated;
}

export async function deleteProjectFile(input: {
  projectId: string;
  path: string;
}): Promise<void> {
  const existing = await prisma.file.findFirst({
    where: { projectId: input.projectId, path: input.path },
    select: { id: true },
  });
  if (!existing) throw new FileNotFoundError(`File not found at ${input.path}`);

  await prisma.file.delete({ where: { id: existing.id } });
  await deleteWorkspaceFile(input.projectId, input.path);
}

export async function readProjectFile(input: {
  projectId: string;
  path: string;
}): Promise<ProjectFileRecord> {
  const metadata = await prisma.file.findFirst({
    where: { projectId: input.projectId, path: input.path },
  });
  if (!metadata) throw new FileNotFoundError(`File not found at ${input.path}`);

  const workspaceContent = await readWorkspaceFile(
    input.projectId,
    input.path,
  );

  return {
    ...metadata,
    content: workspaceContent ?? metadata.content,
  };
}

export async function listProjectFiles(projectId: string) {
  return prisma.file.findMany({
    where: { projectId },
    orderBy: { path: "asc" },
    select: {
      id: true,
      path: true,
      size: true,
      revision: true,
      checksum: true,
      embeddingStatus: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}