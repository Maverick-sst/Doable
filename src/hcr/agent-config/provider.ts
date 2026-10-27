import { resolveDefinition } from "./resolver";
import type {
  AgentConfig,
  ResolveAgentConfigInput,
} from "./types";
import { validateAgentConfig } from "./validation";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    if (Array.isArray(value)) {
      value.forEach(deepFreeze);
    } else {
      for (const key of Object.keys(value)) {
        deepFreeze((value as Record<string, unknown>)[key]);
      }
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Single entry point for the future Agent Loop (§12 runtime contract).
 * Resolution is static today — project/execution IDs are accepted for
 * signature compatibility and ignored, so no execution identity can leak
 * into configuration. Every call returns an isolated deep copy: callers
 * cannot mutate the shared definitions, and successive resolutions are
 * independent.
 */
export const agentConfigProvider = {
  async resolve(input: ResolveAgentConfigInput): Promise<AgentConfig> {
    const definition = resolveDefinition(input.agentType);
    const copy: AgentConfig = JSON.parse(
      JSON.stringify(definition),
    ) as AgentConfig;
    if (input.experimentVariant) {
      copy.experiment = { variant: input.experimentVariant };
    }
    // Validate the effective configuration, including any experiment marker,
    // so a caller cannot bypass catalog-time checks by adding a variant.
    validateAgentConfig(copy, `resolve:${input.agentType}`);
    return deepFreeze(copy);
  },
};
