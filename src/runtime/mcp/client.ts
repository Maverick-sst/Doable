import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { GitHubError } from "@/src/runtime/github/errors";
import {
  githubMcpEnabled,
  githubMcpHeaders,
  githubMcpUrl,
} from "./servers";

const CONNECT_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_CHARS = 16_000;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new GitHubError("mcp_unavailable", "GitHub MCP timed out", 504));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function connect(token: string, timeoutMs = CONNECT_TIMEOUT_MS) {
  if (!githubMcpEnabled()) {
    throw new GitHubError("mcp_unavailable", "GitHub MCP is disabled", 503);
  }
  const client = new Client({ name: "doable", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(githubMcpUrl()), {
    authProvider: { token: async () => token },
    requestInit: { headers: githubMcpHeaders() },
  });
  await withTimeout(
    client.connect(transport, { timeout: timeoutMs }),
    timeoutMs,
    () => {
      void transport.close();
    },
  );
  return { client, transport };
}

export type McpToolResult = {
  text: string;
  bytes: number;
};

function extractText(result: {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
}): string {
  if (result.structuredContent !== undefined) {
    try {
      return JSON.stringify(result.structuredContent);
    } catch {
      return String(result.structuredContent);
    }
  }
  return (result.content ?? [])
    .filter(
      (block): block is { type: "text"; text: string } =>
        block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

export async function callGitHubMcpTool(
  token: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const { client, transport } = await connect(token);
  try {
    const result = await withTimeout(
      client.callTool({ name: toolName, arguments: args }),
      CONNECT_TIMEOUT_MS,
      () => {
        void transport.close();
      },
    );
    if (result.isError) {
      throw new GitHubError(
        "upstream_error",
        "GitHub MCP returned an error",
        502,
      );
    }
    const raw = extractText(result);
    const text =
      raw.length > MAX_OUTPUT_CHARS
        ? `${raw.slice(0, MAX_OUTPUT_CHARS)}\n…(truncated)`
        : raw;
    return { text, bytes: Buffer.byteLength(raw) };
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

export async function probeGitHubMcp(
  token: string,
  timeoutMs = 5_000,
): Promise<boolean> {
  try {
    const { client, transport } = await connect(token, timeoutMs);
    try {
      await withTimeout(client.listTools(), timeoutMs, () => {
        void transport.close();
      });
      return true;
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  } catch {
    return false;
  }
}
