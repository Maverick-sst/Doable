import { ArtifactType } from "@prisma/client";
import { z } from "zod";
import { KNOWN_TOOL_NAMES } from "./tool-names";
import type { AgentConfig } from "./types";

const agentTypeSchema = z.enum([
  "ARCHITECT",
  "RESEARCHER",
  "PRD_REVIEWER",
  "STAFF_ENGINEER",
  "FRONTEND_ENG",
  "BACKEND_ENG",
  "REPAIR_ENG",
]);

const capabilitySchema = z.enum([
  "research",
  "filesystem-access",
  "code-generation",
  "artifact-creation",
  "database-reads",
]);

const promptSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();

const outputContractSchema = z
  .object({
    artifactType: z.nativeEnum(ArtifactType).nullable(),
    mode: z.enum(["structured_json", "tool_calls"]),
  })
  .strict()
  .refine(
    (output) =>
      (output.mode === "structured_json") === (output.artifactType !== null),
    {
      message:
        "structured_json requires an artifact type; tool_calls must not declare one",
    },
  );

const agentConfigSchema = z
  .object({
    agentId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    agentType: agentTypeSchema,
    instructions: z.string().min(1),
    prompt: promptSchema,
    capabilities: z
      .array(capabilitySchema)
      .min(1)
      .refine((items) => new Set(items).size === items.length, {
        message: "capabilities must be unique",
      }),
    toolPolicy: z
      .object({
        eligibleTools: z
          .array(z.enum(KNOWN_TOOL_NAMES))
          .refine((items) => new Set(items).size === items.length, {
            message: "eligibleTools must be unique",
          }),
      })
      .strict(),
    modelPolicy: z
      .object({
        taskProfile: z.enum(["reasoning", "planning", "implementation"]),
        allowFallback: z.boolean(),
      })
      .strict(),
    executionPolicy: z
      .object({
        maxIterations: z.number().int().min(1).max(1000),
      })
      .strict(),
    outputContract: outputContractSchema,
    experiment: z.object({ variant: z.string().min(1) }).strict().optional(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
  })
  .strict();

/** Thrown before any model call when a configuration is malformed. */
export class InvalidAgentConfigError extends Error {
  readonly source: string;
  readonly issues: string[];

  constructor(source: string, issues: string[]) {
    super(`Invalid agent configuration (${source}): ${issues.join("; ")}`);
    this.name = "InvalidAgentConfigError";
    this.source = source;
    this.issues = issues;
  }
}

/**
 * Validates a configuration and returns it typed. Issues are reported by
 * path and message only — never prompt content, which must not reach logs.
 */
export function validateAgentConfig(
  input: unknown,
  source = "agent-config",
): AgentConfig {
  const parsed = agentConfigSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.join(".") || "config";
      return `${path}: ${issue.message}`;
    });
    throw new InvalidAgentConfigError(source, issues);
  }
  return parsed.data as AgentConfig;
}
