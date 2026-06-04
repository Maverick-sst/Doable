export interface DiscoveryRequirement {
  projectIntent: {
    summary: string;
    domain: string;
    projectType: string;
  };
  coreFeatures: string[];
  userFlows: string[];
  constraints: {
    technical: string[];
    product: string[];
    business: string[];
  };
  techStack: {
    frontend?: string;
    backend?: string;
    database?: string;
    auth?: string;
  };
  dataEntities: string[];
  authRequirements: string[];
  integrations: string[];
  assumptions: string[];
  knownAmbiguities: string[];
  confidenceScore: number;
}

export interface ArchitectureSpec {
  projectUnderstanding: {
    oneLiner: string;
    coreValue: string;
    targetUser: string;
    successCriteria: string[];
  };
  architectureDecisions: {
    pattern: string;
    reasoning: string;
    tradeoffs: string[];
  };
  systemBoundaries: {
    frontend: string;
    backend: string;
    database: string;
    externalServices: string[];
  };
  majorImplementationAreas: string[];
  executionStrategy: string;
  risksIdentified: string[];
}

export interface ResearchDossier {
  frameworkRecommendations: {
    name: string;
    version: string;
    justification: string;
    alternatives: string[];
  }[];
  implementationPatterns: {
    area: string;
    recommendedPattern: string;
    codePattern: string;
    reasoning: string;
  }[];
  libraryChoices: {
    library: string;
    purpose: string;
    installCommand: string;
    justification: string;
  }[];
  technicalFindings: string[];
  risks: {
    description: string;
    severity: "low" | "medium" | "high";
    mitigation: string;
  }[];
  projectStructure: {
    directories: string[];
    namingConventions: string;
  };
}

export interface ApprovedPRD {
  validatedRequirements: {
    feature: string;
    acceptanceCriteria: string[];
    priority: "must-have" | "should-have" | "nice-to-have";
    complexity: "low" | "medium" | "high";
  }[];
  clarifiedScope: {
    inScope: string[];
    outOfScope: string[];
    deferredToLater: string[];
  };
  resolvedAmbiguities: {
    ambiguity: string;
    resolution: string;
  }[];
  implementationReadyPlan: {
    phase: string;
    description: string;
    deliverables: string[];
    blockers: string[];
  }[];
  estimatedComplexity: "low" | "medium" | "high";
  approvalNotes: string;
}

export interface ExecutionPlan {
  frontendTasks: {
    id: string;
    title: string;
    description: string;
    filesToCreate: string[];
    filesToModify: string[];
    dependencies: string[];
    estimatedLines: number;
    acceptanceCriteria: string[];
  }[];
  backendTasks: {
    id: string;
    title: string;
    description: string;
    filesToCreate: string[];
    filesToModify: string[];
    dependencies: string[];
    estimatedLines: number;
    acceptanceCriteria: string[];
  }[];
  sharedTasks: {
    id: string;
    title: string;
    description: string;
  }[];
  executionOrder: {
    phase: number;
    taskIds: string[];
    canParallelize: boolean;
  }[];
  projectStructure: {
    rootFiles: string[];
    directories: string[];
  };
  dependencyInstallCommands: string[];
}
