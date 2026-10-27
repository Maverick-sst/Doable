/**
 * Name-only view of the model-facing tool catalog. Configuration never
 * imports tool definitions, so eligibility can be validated without loading
 * or exposing executable contracts. `tests/hcr-agent-config.test.ts` asserts
 * this list stays in sync with `lib/tools.ts`.
 */
export const KNOWN_TOOL_NAMES = [
  "create_file",
  "edit_file",
  "read_file",
  "delete_file",
  "mark_complete",
] as const;

export type KnownToolName = (typeof KNOWN_TOOL_NAMES)[number];
