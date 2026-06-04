import { z } from "zod";
import { ArtifactType } from "@prisma/client";

const PATH_REGEX = /^[A-Za-z0-9._\-/]+$/;

const PathSchema = z
  .string()
  .min(1)
  .max(300)
  .regex(PATH_REGEX, "Path contains invalid characters")
  .refine((p) => !p.startsWith("/"), "Path must be relative")
  .refine((p) => !p.includes(".."), "Path cannot contain '..'")
  .refine((p) => !p.includes("//"), "Path cannot contain '//'");

export const ArchitectureSpecSchema = z.object({
  projectUnderstanding: z.object({
    oneLiner: z.string().min(1),
    coreValue: z.string().min(1),
    targetUser: z.string().min(1),
    successCriteria: z.array(z.string()).min(1),
  }),
  architectureDecisions: z.object({
    pattern: z.string().min(1),
    reasoning: z.string().min(1),
    tradeoffs: z.array(z.string()).min(1),
  }),
  systemBoundaries: z.object({
    frontend: z.string().min(1),
    backend: z.string().min(1),
    database: z.string().min(1),
    externalServices: z.array(z.string()),
  }),
  majorImplementationAreas: z.array(z.string()).min(1),
  executionStrategy: z.string().min(1),
  risksIdentified: z.array(z.string()),
});

export const ResearchDossierSchema = z.object({
  frameworkRecommendations: z.array(
    z.object({
      name: z.string().min(1),
      version: z.string().min(1),
      justification: z.string().min(1),
      alternatives: z.array(z.string()),
    })
  ).min(1, "Must have at least one framework recommendation"),
  implementationPatterns: z.array(
    z.object({
      area: z.string().min(1),
      recommendedPattern: z.string().min(1),
      codePattern: z.string().min(1),
      reasoning: z.string().min(1),
    })
  ),
  libraryChoices: z.array(
    z.object({
      library: z.string().min(1),
      purpose: z.string().min(1),
      installCommand: z.string().min(1),
      justification: z.string().min(1),
    })
  ),
  technicalFindings: z.array(z.string()),
  risks: z.array(
    z.object({
      description: z.string().min(1),
      severity: z.enum(["low", "medium", "high"]),
      mitigation: z.string().min(1),
    })
  ),
  projectStructure: z.object({
    directories: z.array(z.string()),
    namingConventions: z.string(),
  }),
});

export const ApprovedPRDSchema = z.object({
  validatedRequirements: z.array(
    z.object({
      feature: z.string().min(1),
      acceptanceCriteria: z.array(z.string()).min(1),
      priority: z.enum(["must-have", "should-have", "nice-to-have"]),
      complexity: z.enum(["low", "medium", "high"]),
    })
  ).min(1, "Must have at least one validated requirement"),
  clarifiedScope: z.object({
    inScope: z.array(z.string()).min(1),
    outOfScope: z.array(z.string()),
    deferredToLater: z.array(z.string()),
  }),
  resolvedAmbiguities: z.array(
    z.object({
      ambiguity: z.string().min(1),
      resolution: z.string().min(1),
    })
  ),
  implementationReadyPlan: z.array(
    z.object({
      phase: z.string().min(1),
      description: z.string().min(1),
      deliverables: z.array(z.string()).min(1),
      blockers: z.array(z.string()),
    })
  ).min(1, "Must have at least one implementation phase"),
  estimatedComplexity: z.enum(["low", "medium", "high"]),
  approvalNotes: z.string(),
});

export const ExecutionPlanSchema = z.object({
  frontendTasks: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
      filesToCreate: z.array(PathSchema),
      filesToModify: z.array(PathSchema),
      dependencies: z.array(z.string()),
      estimatedLines: z.number(),
      acceptanceCriteria: z.array(z.string()).min(1),
    })
  ).min(1, "Must have at least one frontend task"),
  backendTasks: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
      filesToCreate: z.array(PathSchema),
      filesToModify: z.array(PathSchema),
      dependencies: z.array(z.string()),
      estimatedLines: z.number(),
      acceptanceCriteria: z.array(z.string()).min(1),
    })
  ),
  sharedTasks: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
    })
  ),
  executionOrder: z.array(
    z.object({
      phase: z.number(),
      taskIds: z.array(z.string()).min(1),
      canParallelize: z.boolean(),
    })
  ).min(1),
  projectStructure: z.object({
    rootFiles: z.array(z.string()),
    directories: z.array(z.string()),
  }),
  dependencyInstallCommands: z.array(z.string()),
});

export function validateArtifact(type: ArtifactType, content: unknown): Record<string, unknown> {
  let result;
  switch (type) {
    case ArtifactType.ARCHITECTURE_SPEC:
      result = ArchitectureSpecSchema.safeParse(content);
      break;
    case ArtifactType.RESEARCH_DOSSIER:
      result = ResearchDossierSchema.safeParse(content);
      break;
    case ArtifactType.APPROVED_PRD:
      result = ApprovedPRDSchema.safeParse(content);
      break;
    case ArtifactType.EXECUTION_PLAN:
      result = ExecutionPlanSchema.safeParse(content);
      break;
    default:
      throw new Error(`Unsupported artifact validation type: ${type}`);
  }

  if (!result.success) {
    throw new Error(`Artifact validation failed for type ${type}: ${result.error.message}`);
  }

  return result.data as Record<string, unknown>;
}
