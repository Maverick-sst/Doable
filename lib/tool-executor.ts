import { NodeStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma";
import { ContentSchema, PathSchema } from "@/src/shared/validations/file";
import {
  createProjectFile,
  deleteProjectFile,
  FileConflictError,
  FileNotFoundError,
  readProjectFile,
  updateProjectFile,
} from "@/src/runtime/files";

const CreateFileArgs = z.object({
  path: PathSchema,
  content: ContentSchema,
});

const EditFileArgs = z.object({
  path: PathSchema,
  old_str: z.string().max(2_000_000),
  new_str: ContentSchema,
});

const PathArgs = z.object({ path: PathSchema });

const MarkCompleteArgs = z.object({
  summary: z.string().min(1).max(4000),
});

type ToolArgs = Record<string, unknown>;

function parseArgs<T extends z.ZodTypeAny>(
  schema: T,
  args: unknown,
): z.infer<T> | string {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return `Error: Invalid tool arguments: ${parsed.error.issues
      .map((issue) => issue.message)
      .join("; ")}`;
  }
  return parsed.data;
}

export async function executeTool(
  toolName: string,
  args: ToolArgs,
  projectId: string,
  userId: string,
  executionId: string,
  nodeId: string,
): Promise<string> {
  await validateProjectAccess(projectId, userId);

  try {
    switch (toolName) {
      case "create_file": {
        const parsed = parseArgs(CreateFileArgs, args);
        if (typeof parsed === "string") return parsed;
        return await createFile(parsed.path, parsed.content, projectId);
      }
      case "edit_file": {
        const parsed = parseArgs(EditFileArgs, args);
        if (typeof parsed === "string") return parsed;
        return await editFile(parsed, projectId);
      }
      case "read_file": {
        const parsed = parseArgs(PathArgs, args);
        if (typeof parsed === "string") return parsed;
        return await readFile(parsed.path, projectId);
      }
      case "delete_file": {
        const parsed = parseArgs(PathArgs, args);
        if (typeof parsed === "string") return parsed;
        return await deleteFile(parsed.path, projectId);
      }
      case "mark_complete": {
        const parsed = parseArgs(MarkCompleteArgs, args);
        if (typeof parsed === "string") return parsed;
        return await markComplete(parsed.summary, projectId, executionId, nodeId);
      }
      default:
        return `Error: Invalid tool name: ${toolName}`;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: Tool execution failed: ${message}`;
  }
}

async function validateProjectAccess(
  projectId: string,
  userId: string,
): Promise<void> {
  const project = await prisma.project.count({
    where: { id: projectId, userId },
  });
  if (project === 0) {
    throw new Error("Project not found or access denied");
  }
}

async function createFile(
  path: string,
  content: string,
  projectId: string,
): Promise<string> {
  try {
    const file = await createProjectFile({ projectId, path, content });
    return `File created successfully with id: ${file.id} and path: ${file.path}`;
  } catch (error) {
    if (error instanceof FileConflictError) {
      return `Error: ${error.message}. Use edit_file or read_file.`;
    }
    throw error;
  }
}

async function editFile(
  args: { path: string; old_str: string; new_str: string },
  projectId: string,
): Promise<string> {
  const { path, old_str, new_str } = args;
  let existing;
  try {
    existing = await readProjectFile({ projectId, path });
  } catch (error) {
    if (error instanceof FileNotFoundError) {
      return `Error: File not found at path: ${path}`;
    }
    throw error;
  }

  let newContent = existing.content;
  if (!old_str) {
    newContent = new_str;
  } else {
    if (!existing.content.includes(old_str)) {
      return "Error: old_str not found in file content";
    }
    newContent = existing.content.replace(old_str, new_str);
  }

  const updated = await updateProjectFile({ projectId, path, content: newContent });
  return `File updated successfully at path: ${updated.path}`;
}

async function readFile(path: string, projectId: string): Promise<string> {
  try {
    const file = await readProjectFile({ projectId, path });
    return file.content;
  } catch (error) {
    if (error instanceof FileNotFoundError) {
      return `Error: File not found at path: ${path}`;
    }
    throw error;
  }
}

async function deleteFile(path: string, projectId: string): Promise<string> {
  try {
    await deleteProjectFile({ projectId, path });
    return `File at path ${path} deleted successfully.`;
  } catch (error) {
    if (error instanceof FileNotFoundError) {
      return `Error: File not found at path: ${path}`;
    }
    throw error;
  }
}

async function markComplete(
  summary: string,
  projectId: string,
  executionId: string,
  nodeId: string,
): Promise<string> {
  await prisma.projectMemory.update({
    where: { projectId },
    data: { summary },
  });

  const changed = await prisma.node.updateMany({
    where: { id: nodeId, status: { not: NodeStatus.COMPLETED } },
    data: { status: NodeStatus.COMPLETED, finishedAt: new Date() },
  });

  if (changed.count > 0) {
    await prisma.runtimeEvent.create({
      data: {
        executionId,
        nodeId,
        type: "node.completed",
        payload: { nodeId, summary },
      },
    });
  }

  return "Work marked complete with summary.";
}