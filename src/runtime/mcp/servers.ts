export const GITHUB_MCP_SERVER_ID = "github";

export const GITHUB_MCP_TOOL_NAMES = [
  "get_file_contents",
  "list_branches",
  "list_commits",
  "list_issues",
  "issue_read",
  "list_pull_requests",
  "pull_request_read",
  "search_code",
] as const;

export type GitHubMcpToolName = (typeof GITHUB_MCP_TOOL_NAMES)[number];

export function githubMcpUrl(): string {
  return process.env.GITHUB_MCP_URL?.trim() || "https://api.githubcopilot.com/mcp/";
}

export function githubMcpEnabled(): boolean {
  return process.env.GITHUB_MCP_ENABLED !== "false";
}

export function githubMcpHeaders(): Record<string, string> {
  return {
    "X-MCP-Readonly": "true",
    "X-MCP-Tools": GITHUB_MCP_TOOL_NAMES.join(","),
  };
}
