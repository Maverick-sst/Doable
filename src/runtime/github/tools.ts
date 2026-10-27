import { z } from "zod";
import type { ToolDefinition } from "@/src/providers";
import { prisma } from "@/lib/prisma";
import { callGitHubMcpTool } from "@/src/runtime/mcp/client";
import {
  githubMcpEnabled,
  type GitHubMcpToolName,
} from "@/src/runtime/mcp/servers";
import { GitHubError, asGitHubError } from "./errors";
import { resolveGitHubToken } from "./token-crypto";

export const GITHUB_READ_TOOL_NAMES = [
  "github_get_repo",
  "github_read_file",
  "github_list_branches",
  "github_list_commits",
  "github_list_issues",
  "github_read_issue",
  "github_list_pull_requests",
  "github_read_pull_request",
  "github_search_code",
] as const;

export type GitHubReadToolName = (typeof GITHUB_READ_TOOL_NAMES)[number];

export const githubToolDefinitions: readonly ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "github_get_repo",
      description:
        "List the root of the linked GitHub repository and confirm access. The repository is injected by the server.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_read_file",
      description:
        "Read a file from the linked GitHub repository. Use paths relative to the repository root.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "Repository-relative path" },
          ref: {
            type: "string",
            description: "Optional branch, tag, or commit SHA",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_list_branches",
      description: "List branches on the linked GitHub repository.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "number", description: "1-100 branches" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_list_commits",
      description: "List recent commits on the linked GitHub repository.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          branch: { type: "string", description: "Optional branch name" },
          limit: { type: "number", description: "1-50 commits" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_list_issues",
      description: "List issues on the linked GitHub repository.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          state: { type: "string", enum: ["open", "closed", "all"] },
          limit: { type: "number", description: "1-50 issues" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_read_issue",
      description: "Read one issue from the linked GitHub repository.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          number: { type: "number", description: "Issue number" },
        },
        required: ["number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_list_pull_requests",
      description: "List pull requests on the linked GitHub repository.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          state: { type: "string", enum: ["open", "closed", "all"] },
          limit: { type: "number", description: "1-50 pull requests" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_read_pull_request",
      description: "Read one pull request from the linked GitHub repository.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          number: { type: "number", description: "Pull request number" },
        },
        required: ["number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_search_code",
      description:
        "Search code in the linked GitHub repository. Other repositories cannot be targeted.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Code search text" },
          limit: { type: "number", description: "1-50 results" },
        },
        required: ["query"],
      },
    },
  },
] as const;

const EmptyArgs = z.object({}).strict();
const ReadFileArgs = z
  .object({
    path: z.string().min(1).max(500),
    ref: z.string().min(1).max(200).optional(),
  })
  .strict();
const ListBranchesArgs = z
  .object({ limit: z.number().int().min(1).max(100).optional() })
  .strict();
const ListCommitsArgs = z
  .object({
    branch: z.string().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();
const ListStateArgs = z
  .object({
    state: z.enum(["open", "closed", "all"]).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();
const ReadNumberArgs = z
  .object({ number: z.number().int().min(1).max(1_000_000_000) })
  .strict();
const SearchArgs = z
  .object({
    query: z.string().min(1).max(256),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

function safePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => part === "..")) {
    throw new GitHubError("invalid_request", "Invalid repository path", 400);
  }
  return normalized;
}

function parse<T>(schema: z.ZodType<T>, args: Record<string, unknown>): T {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw new GitHubError("invalid_request", "Invalid GitHub tool arguments", 400);
  }
  return parsed.data;
}

export function isGitHubReadTool(name: string): name is GitHubReadToolName {
  return (GITHUB_READ_TOOL_NAMES as readonly string[]).includes(name);
}

export async function hasGitHubReadAccess(
  projectId: string,
  userId: string,
): Promise<boolean> {
  if (!githubMcpEnabled()) return false;
  const link = await prisma.projectGitHubLink.findFirst({
    where: { projectId, project: { userId, archivedAt: null } },
    select: { id: true, connection: { select: { id: true } } },
  });
  if (!link) return false;
  return Boolean(link.connection || process.env.GITHUB_TOKEN?.trim());
}

async function loadLinkedRepo(projectId: string, userId: string) {
  const link = await prisma.projectGitHubLink.findFirst({
    where: { projectId, project: { userId, archivedAt: null } },
    include: { connection: true },
  });
  if (!link) {
    throw new GitHubError(
      "not_configured",
      "This project is not linked to a GitHub repository",
      409,
    );
  }
  const connection =
    link.connection ??
    (await prisma.gitHubConnection.findUnique({ where: { userId } }));
  const token = resolveGitHubToken(connection);
  return { link, token };
}

type McpCall = {
  mcpTool: GitHubMcpToolName;
  mcpArgs: Record<string, unknown>;
  detail: Record<string, string | number>;
};

function mapTool(
  name: GitHubReadToolName,
  args: Record<string, unknown>,
  owner: string,
  repo: string,
): McpCall {
  switch (name) {
    case "github_get_repo": {
      parse(EmptyArgs, args);
      return {
        mcpTool: "get_file_contents",
        mcpArgs: { owner, repo, path: "/" },
        detail: {},
      };
    }
    case "github_read_file": {
      const parsed = parse(ReadFileArgs, args);
      const path = safePath(parsed.path);
      return {
        mcpTool: "get_file_contents",
        mcpArgs: {
          owner,
          repo,
          path,
          ...(parsed.ref ? { ref: parsed.ref } : {}),
        },
        detail: { path },
      };
    }
    case "github_list_branches": {
      const parsed = parse(ListBranchesArgs, args);
      return {
        mcpTool: "list_branches",
        mcpArgs: { owner, repo, ...(parsed.limit ? { perPage: parsed.limit } : {}) },
        detail: {},
      };
    }
    case "github_list_commits": {
      const parsed = parse(ListCommitsArgs, args);
      return {
        mcpTool: "list_commits",
        mcpArgs: {
          owner,
          repo,
          ...(parsed.branch ? { sha: parsed.branch } : {}),
          ...(parsed.limit ? { perPage: parsed.limit } : {}),
        },
        detail: parsed.branch ? { branch: parsed.branch } : {},
      };
    }
    case "github_list_issues": {
      const parsed = parse(ListStateArgs, args);
      return {
        mcpTool: "list_issues",
        mcpArgs: {
          owner,
          repo,
          ...(parsed.state ? { state: parsed.state } : {}),
          ...(parsed.limit ? { perPage: parsed.limit } : {}),
        },
        detail: parsed.state ? { state: parsed.state } : {},
      };
    }
    case "github_read_issue": {
      const parsed = parse(ReadNumberArgs, args);
      return {
        mcpTool: "issue_read",
        mcpArgs: {
          owner,
          repo,
          issue_number: parsed.number,
          method: "get",
        },
        detail: { number: parsed.number },
      };
    }
    case "github_list_pull_requests": {
      const parsed = parse(ListStateArgs, args);
      return {
        mcpTool: "list_pull_requests",
        mcpArgs: {
          owner,
          repo,
          ...(parsed.state ? { state: parsed.state } : {}),
          ...(parsed.limit ? { perPage: parsed.limit } : {}),
        },
        detail: parsed.state ? { state: parsed.state } : {},
      };
    }
    case "github_read_pull_request": {
      const parsed = parse(ReadNumberArgs, args);
      return {
        mcpTool: "pull_request_read",
        mcpArgs: {
          owner,
          repo,
          pullNumber: parsed.number,
          method: "get",
        },
        detail: { number: parsed.number },
      };
    }
    case "github_search_code": {
      const parsed = parse(SearchArgs, args);
      if (/\b(repo|org|user):/i.test(parsed.query)) {
        throw new GitHubError(
          "invalid_request",
          "Repository qualifiers are not allowed in GitHub code search",
          400,
        );
      }
      return {
        mcpTool: "search_code",
        mcpArgs: {
          query: `${parsed.query} repo:${owner}/${repo}`,
          ...(parsed.limit ? { perPage: parsed.limit } : {}),
        },
        detail: { queryLength: parsed.query.length },
      };
    }
  }
}

export async function executeGitHubReadTool(input: {
  toolName: GitHubReadToolName;
  args: Record<string, unknown>;
  projectId: string;
  userId: string;
}): Promise<{
  content: string;
  audit: Record<string, string | number | boolean>;
}> {
  const startedAt = performance.now();
  try {
    const { link, token } = await loadLinkedRepo(input.projectId, input.userId);
    const call = mapTool(
      input.toolName,
      input.args,
      link.owner,
      link.repo,
    );
    const result = await callGitHubMcpTool(token, call.mcpTool, call.mcpArgs);
    return {
      content:
        result.text.length > 0
          ? result.text
          : "GitHub returned no readable content.",
      audit: {
        tool: input.toolName,
        repo: `${link.owner}/${link.repo}`,
        status: "ok",
        latencyMs: Math.round(performance.now() - startedAt),
        bytes: result.bytes,
        ...call.detail,
      },
    };
  } catch (error) {
    const safe = asGitHubError(error);
    return {
      content: `Error: ${safe.message}`,
      audit: {
        tool: input.toolName,
        status: "error",
        errorCode: safe.code,
        latencyMs: Math.round(performance.now() - startedAt),
        bytes: 0,
      },
    };
  }
}
