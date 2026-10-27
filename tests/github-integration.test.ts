import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  computeManifestHash,
  planPush,
  planStats,
  type WorkspaceManifest,
} from "@/src/runtime/github/snapshot";
import {
  decryptGitHubToken,
  encryptGitHubToken,
  encryptionConfigured,
  maskToken,
} from "@/src/runtime/github/token-crypto";
import {
  GITHUB_READ_TOOL_NAMES,
  githubToolDefinitions,
  isGitHubReadTool,
} from "@/src/runtime/github/tools";
import {
  GITHUB_MCP_TOOL_NAMES,
  githubMcpHeaders,
} from "@/src/runtime/mcp/servers";

const originalKey = process.env.APP_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
  else process.env.APP_ENCRYPTION_KEY = originalKey;
});

describe("workspace manifest", () => {
  test("hash is stable regardless of input order", () => {
    const files = [
      { path: "b.ts", checksum: "bbb", size: 2 },
      { path: "a.ts", checksum: "aaa", size: 1 },
    ];
    expect(computeManifestHash(files)).toBe(
      computeManifestHash([...files].reverse()),
    );
  });

  test("hash changes when content or size changes", () => {
    const base = [{ path: "a.ts", checksum: "aaa", size: 1 }];
    expect(computeManifestHash(base)).not.toBe(
      computeManifestHash([{ path: "a.ts", checksum: "aab", size: 1 }]),
    );
    expect(computeManifestHash(base)).not.toBe(
      computeManifestHash([{ path: "a.ts", checksum: "aaa", size: 2 }]),
    );
  });
});

describe("push plan", () => {
  const manifest: WorkspaceManifest = {
    files: [
      {
        path: "src/a.ts",
        contentBase64: "",
        checksum: "1",
        size: 1,
        gitSha: "changed",
      },
      {
        path: "src/new.ts",
        contentBase64: "",
        checksum: "2",
        size: 1,
        gitSha: "new",
      },
    ],
    totalBytes: 2,
    manifestHash: "hash",
  };
  const base = [
    { path: "src/a.ts", sha: "one" },
    { path: "src/gone.ts", sha: "two" },
  ];

  test("splits additions, updates, and refuses deletions by default", () => {
    const plan = planPush(manifest, base, false);
    expect(plan.additions).toEqual(["src/new.ts"]);
    expect(plan.updates).toEqual(["src/a.ts"]);
    expect(plan.deletions).toEqual([]);
    expect(planStats(plan)).toEqual({
      additions: 1,
      updates: 1,
      deletions: 0,
      files: 2,
    });
  });

  test("skips files whose Git blob SHA matches the remote", () => {
    const unchanged: WorkspaceManifest = {
      files: [
        {
          path: "src/a.ts",
          contentBase64: "",
          checksum: "1",
          size: 1,
          gitSha: "one",
        },
      ],
      totalBytes: 1,
      manifestHash: "hash",
    };
    const plan = planPush(unchanged, base, false);
    expect(plan.additions).toEqual([]);
    expect(plan.updates).toEqual([]);
  });

  test("includes deletions only when explicitly allowed", () => {
    const plan = planPush(manifest, base, true);
    expect(plan.deletions).toEqual(["src/gone.ts"]);
    expect(planStats(plan).deletions).toBe(1);
  });
});

describe("github token encryption", () => {
  test("round-trips a token and keeps the last four characters", () => {
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(encryptionConfigured()).toBe(true);
    const token = "github_pat_abcdefghijklmnop1234";
    const encrypted = encryptGitHubToken(token);
    expect(encrypted.tokenCiphertext).not.toContain(token);
    expect(encrypted.tokenLast4).toBe("1234");
    expect(decryptGitHubToken(encrypted)).toBe(token);
    expect(maskToken(token)).toBe("••••1234");
  });

  test("rejects a key with the wrong length", () => {
    process.env.APP_ENCRYPTION_KEY = Buffer.from("short").toString("base64");
    expect(encryptionConfigured()).toBe(false);
    expect(() => encryptGitHubToken("token")).toThrow(
      "APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
    );
  });

  test("rejects a tampered ciphertext", () => {
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const encrypted = encryptGitHubToken("github_pat_secret");
    expect(() =>
      decryptGitHubToken({
        ...encrypted,
        tokenCiphertext: Buffer.from("tampered").toString("base64"),
      }),
    ).toThrow("Stored GitHub token could not be decrypted");
  });
});

describe("github read tools", () => {
  test("definitions match the curated allowlist", () => {
    const names = githubToolDefinitions.map((tool) => tool.function.name);
    expect(names).toEqual([...GITHUB_READ_TOOL_NAMES]);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(isGitHubReadTool(name)).toBe(true);
  });

  test("does not treat builtins or unknown names as GitHub tools", () => {
    expect(isGitHubReadTool("create_file")).toBe(false);
    expect(isGitHubReadTool("github_delete_repo")).toBe(false);
  });

  test("MCP allowlist uses the official consolidated tool names", () => {
    expect([...GITHUB_MCP_TOOL_NAMES]).toEqual([
      "get_file_contents",
      "list_branches",
      "list_commits",
      "list_issues",
      "issue_read",
      "list_pull_requests",
      "pull_request_read",
      "search_code",
    ]);
    const tools = githubMcpHeaders()["X-MCP-Tools"] ?? "";
    expect(tools).toContain("issue_read");
    expect(tools).toContain("pull_request_read");
    expect(tools).not.toContain("get_issue");
    expect(tools).not.toContain("get_pull_request");
  });
});
