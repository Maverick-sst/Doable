# GitHub integration

Doable's GitHub integration has two deliberately separate paths:

1. **Reads** for agents, through the official read-only GitHub MCP server.
2. **Writes** to a new branch, through the GitHub REST/Git Data API, only after
   the user previews and confirms a push.

Composio is not part of this path. The integration is project-scoped and
user-scoped; the model never supplies `owner`, `repo`, or project identity.

## Seams

| Seam | Location | Responsibility |
| --- | --- | --- |
| Token storage | `src/runtime/github/token-crypto.ts` | AES-256-GCM at rest, `GITHUB_TOKEN` fallback, no token logging |
| GitHub REST | `src/runtime/github/client.ts` | Repositories, trees, blobs, commits, refs, PRs |
| MCP | `src/runtime/mcp/` | Connect, call, probe, read-only allowlist, output cap |
| Model tools | `src/runtime/github/tools.ts` | Zod validation, MCP mapping, audit metadata |
| Snapshot | `src/runtime/github/snapshot.ts` | Workspace manifest, limits, diff, stats |
| Push | `src/runtime/github/push.ts` | Preview, confirm, atomic commit, state transitions |
| HTTP | `app/api/github`, `app/api/projects/[id]/github` | Auth-scoped connection, link, push routes |

## Agent reads

The curated model tools are `github_get_repo`, `github_read_file`,
`github_list_branches`, `github_list_commits`, `github_list_issues`,
`github_read_issue`, `github_list_pull_requests`, `github_read_pull_request`,
and `github_search_code`.

- The server injects the linked repository; code search appends
  `repo:owner/name` and rejects model-supplied `repo:`, `org:`, or `user:`
  qualifiers.
- Tool arguments are strict Zod objects. Output is capped at 16 KB.
- GitHub tool names are added to the effective agent configuration at runtime
  only when the project is linked and a token is configured. The static
  builtin catalog and its exact-name test stay unchanged.
- `ToolCall.result` stores audit JSON only (tool, repo, path/ID, latency,
  bytes, status). Raw file contents, issue text, and MCP output are not
  persisted in events.
- If MCP is disabled, GitHub tools are omitted and the build continues. A
  failed MCP call returns a safe error to the model and does not abort the
  build.

## Push flow

1. **Preview** reads the workspace through `readWorkspaceSnapshot`, reads the
   base branch tree from GitHub, and persists a `PENDING` `GitHubPush` with the
   manifest hash, base SHA, and diff stats. Prior pending previews for the same
   project are cancelled.
2. **Confirm** requires the caller's `manifestHash` to match the stored preview.
   The workspace is snapshotted again. If the hash or base branch SHA moved,
   the request is refused with `409` and no write occurs.
3. The push creates blobs for added/updated files, one tree with `base_tree`,
   one commit, and a new branch named `doable/<slug>-<random>`. It never writes
   the default branch and never force-updates a ref.
4. A pull request is optional. Failure to open a PR does not remove the branch
   or fail the commit; the push is still reported `COMPLETED` with no PR URL.
5. State is `PENDING → CONFIRMED → COMPLETED | FAILED`; unconfirmed previews
   can become `CANCELLED`.

Limits: 1 MB per file, 50 MB total, 2,000 files, and a non-truncated GitHub
tree. Symlinks, path traversal, and `.env*` files are excluded from the
snapshot. Deletions are shown in the preview but are applied only when the
user opts in. Empty repositories are unsupported in this version.

## Configuration

```bash
# Encrypts stored tokens. Generate with: openssl rand -base64 32
APP_ENCRYPTION_KEY=

# Optional server-side fallback when no token is stored.
GITHUB_TOKEN=

# Read-only MCP endpoint and kill switch.
GITHUB_MCP_URL=https://api.githubcopilot.com/mcp/
GITHUB_MCP_ENABLED=true
```

Token scopes:

- Classic PAT: `repo`; add `workflow` only if `.github/workflows` changes.
- Fine-grained: Contents read/write, Pull requests read/write, Metadata read.

The Settings page stores a token encrypted and shows only the last four
characters. The API never returns a token. Health reports
`integrations.github.{configured,connected,mcpReachable}` without identity or
repository details.

## Failure codes

Safe codes surfaced to the UI include `not_configured`,
`encryption_key_missing`, `invalid_token`, `unauthorized`, `forbidden`,
`not_found`, `conflict`, `rate_limited`, `upstream_error`, `invalid_request`,
`push_limit_exceeded`, `push_not_pending`, `push_base_moved`,
`empty_repository`, and `mcp_unavailable`.

## Deferred

- GitHub OAuth and device flow.
- Agent-callable GitHub writes.
- GitLab, Linear, and other integrations.
- Migrating builtin file tools into a general MCP registry.
- Draft-PR-only mode and partial-file selection.
