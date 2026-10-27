import { createHash } from "node:crypto";
import type { AgentConfig } from "./types";

export function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

/**
 * Stable, key-sorted serialization. Configuration fields are declared in code,
 * so object key order is otherwise an accident of editing and must not change
 * the recorded hash.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
  return `{${entries.join(",")}}`;
}

/** Hash of the effective configuration, including its prompt hash and version. */
export function hashAgentConfig(config: AgentConfig): string {
  return sha256(canonicalize(config));
}
