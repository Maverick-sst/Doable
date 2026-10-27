import { GitHubError } from "./errors";

const API_BASE = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 20_000;

export type GitHubUser = {
  login: string;
  id: number;
};

export type GitHubRepository = {
  fullName: string;
  defaultBranch: string;
  htmlUrl: string;
  private: boolean;
  permissions?: { push?: boolean; admin?: boolean };
};

export type GitHubTreeEntry = {
  path: string;
  sha: string;
  size?: number;
};

export type GitHubCommitResult = {
  sha: string;
  htmlUrl: string;
};

export type GitHubPullRequestResult = {
  number: number;
  htmlUrl: string;
};

async function request<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  headers.set("User-Agent", "doable-local");

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GitHubError("upstream_error", "GitHub request failed", 502);
  }

  if (!response.ok) {
    const status = response.status;
    if (status === 401) {
      throw new GitHubError("unauthorized", "GitHub token was rejected", 401);
    }
    if (status === 403) {
      const code =
        response.headers.get("x-ratelimit-remaining") === "0"
          ? "rate_limited"
          : "forbidden";
      throw new GitHubError(
        code,
        code === "rate_limited"
          ? "GitHub rate limit reached"
          : "GitHub denied the request",
        403,
      );
    }
    if (status === 404) {
      throw new GitHubError("not_found", "GitHub resource not found", 404);
    }
    if (status === 409) {
      throw new GitHubError("conflict", "GitHub reported a conflict", 409);
    }
    if (status === 422) {
      throw new GitHubError(
        "invalid_request",
        "GitHub rejected the request",
        422,
      );
    }
    throw new GitHubError("upstream_error", "GitHub request failed", 502);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function getAuthenticatedUser(token: string): Promise<GitHubUser> {
  return request<GitHubUser>(token, "/user");
}

export async function getRepository(
  token: string,
  owner: string,
  repo: string,
): Promise<GitHubRepository> {
  const data = await request<{
    full_name: string;
    default_branch: string;
    html_url: string;
    private: boolean;
    permissions?: { push?: boolean; admin?: boolean };
  }>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  return {
    fullName: data.full_name,
    defaultBranch: data.default_branch,
    htmlUrl: data.html_url,
    private: data.private,
    permissions: data.permissions,
  };
}

export async function getBranchHead(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ sha: string }> {
  const data = await request<{ object?: { sha?: string } }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
  );
  const sha = data.object?.sha;
  if (!sha) {
    throw new GitHubError("not_found", "GitHub branch not found", 404);
  }
  return { sha };
}

export async function getCommitTreeSha(
  token: string,
  owner: string,
  repo: string,
  commitSha: string,
): Promise<string> {
  const data = await request<{ tree?: { sha?: string } }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${encodeURIComponent(commitSha)}`,
  );
  const sha = data.tree?.sha;
  if (!sha) {
    throw new GitHubError("upstream_error", "GitHub commit is incomplete", 502);
  }
  return sha;
}

export async function getTree(
  token: string,
  owner: string,
  repo: string,
  treeSha: string,
): Promise<GitHubTreeEntry[]> {
  const data = await request<{
    truncated?: boolean;
    tree?: Array<{ path?: string; sha?: string; type?: string; size?: number }>;
  }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
  );
  if (data.truncated) {
    throw new GitHubError(
      "push_limit_exceeded",
      "GitHub tree is too large to compare safely",
      413,
    );
  }
  return (data.tree ?? [])
    .filter(
      (entry): entry is { path: string; sha: string; type: "blob"; size?: number } =>
        entry.type === "blob" &&
        typeof entry.path === "string" &&
        typeof entry.sha === "string",
    )
    .map((entry) => ({ path: entry.path, sha: entry.sha, size: entry.size }));
}

export async function createBlob(
  token: string,
  owner: string,
  repo: string,
  contentBase64: string,
): Promise<string> {
  const data = await request<{ sha?: string }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`,
    {
      method: "POST",
      body: JSON.stringify({ content: contentBase64, encoding: "base64" }),
    },
  );
  if (!data.sha) {
    throw new GitHubError("upstream_error", "GitHub did not create a blob", 502);
  }
  return data.sha;
}

export type GitHubTreeChange = {
  path: string;
  sha: string | null;
  mode?: "100644";
  type?: "blob";
};

export async function createTree(
  token: string,
  owner: string,
  repo: string,
  baseTree: string,
  changes: GitHubTreeChange[],
): Promise<string> {
  const data = await request<{ sha?: string }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({
        base_tree: baseTree,
        tree: changes.map((change) => ({
          path: change.path,
          mode: change.mode ?? "100644",
          type: change.type ?? "blob",
          sha: change.sha,
        })),
      }),
    },
  );
  if (!data.sha) {
    throw new GitHubError("upstream_error", "GitHub did not create a tree", 502);
  }
  return data.sha;
}

export async function createCommit(
  token: string,
  owner: string,
  repo: string,
  input: { message: string; tree: string; parents: string[] },
): Promise<GitHubCommitResult> {
  const data = await request<{ sha?: string; html_url?: string }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message: input.message,
        tree: input.tree,
        parents: input.parents,
      }),
    },
  );
  if (!data.sha) {
    throw new GitHubError(
      "upstream_error",
      "GitHub did not create a commit",
      502,
    );
  }
  return { sha: data.sha, htmlUrl: data.html_url ?? "" };
}

export async function createBranch(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  sha: string,
): Promise<void> {
  await request(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
    {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    },
  );
}

export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  input: { title: string; head: string; base: string; body: string },
): Promise<GitHubPullRequestResult> {
  const data = await request<{ number?: number; html_url?: string }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        head: input.head,
        base: input.base,
        body: input.body,
      }),
    },
  );
  if (!data.number || !data.html_url) {
    throw new GitHubError(
      "upstream_error",
      "GitHub did not create a pull request",
      502,
    );
  }
  return { number: data.number, htmlUrl: data.html_url };
}
