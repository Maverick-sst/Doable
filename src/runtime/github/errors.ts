export type GitHubErrorCode =
  | "not_configured"
  | "encryption_key_missing"
  | "invalid_token"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "upstream_error"
  | "invalid_request"
  | "push_limit_exceeded"
  | "push_base_moved"
  | "push_not_pending"
  | "empty_repository"
  | "mcp_unavailable";

export class GitHubError extends Error {
  readonly code: GitHubErrorCode;
  readonly httpStatus: number;

  constructor(code: GitHubErrorCode, message: string, httpStatus = 400) {
    super(message);
    this.name = "GitHubError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function asGitHubError(error: unknown): GitHubError {
  if (error instanceof GitHubError) return error;
  return new GitHubError("upstream_error", "GitHub request failed", 502);
}
