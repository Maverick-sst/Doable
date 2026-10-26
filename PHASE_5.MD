# Phase 5A PRD — Hierarchical Cognitive Runtime: Multi-Node Cognitive Graph

**Project:** Doable
**Phase:** 5A
**Status:** Pre-Implementation
**Author:** Generated from architecture audit + Phase 5 vision
**Branch base:** `feat/phase4_HCR`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Audit](#2-current-state-audit)
3. [Target State](#3-target-state)
4. [Core Architectural Principles](#4-core-architectural-principles)
5. [Database Schema Changes](#5-database-schema-changes)
6. [Deliverable 1 — Node Executor Framework](#6-deliverable-1--node-executor-framework)
7. [Deliverable 2 — Agent Registry](#7-deliverable-2--agent-registry)
8. [Deliverable 3 — Artifact Contracts](#8-deliverable-3--artifact-contracts)
9. [Deliverable 4 — Artifact-Driven Workflow Progression](#9-deliverable-4--artifact-driven-workflow-progression)
10. [Deliverable 5 — Workflow State Progression & Coordinator](#10-deliverable-5--workflow-state-progression--coordinator)
11. [Inngest Function Architecture](#11-inngest-function-architecture)
12. [System Prompts Per Node](#12-system-prompts-per-node)
13. [Context Engine Adaptation Per Node](#13-context-engine-adaptation-per-node)
14. [Tool Access Matrix](#14-tool-access-matrix)
15. [File & Folder Structure](#15-file--folder-structure)
16. [Implementation Plan — Step by Step](#16-implementation-plan--step-by-step)
17. [Edge Cases & Loopholes](#17-edge-cases--loopholes)
18. [Testing Checklist](#18-testing-checklist)
19. [Definition of Done](#19-definition-of-done)
20. [What is Explicitly Out of Scope](#20-what-is-explicitly-out-of-scope)

---

## 1. Executive Summary

Phase 4 produced a working but cognitively monolithic runtime. A single "Architect" Inngest function carries the full cognitive load: it understands requirements, researches solutions, validates them, decomposes tasks, writes frontend code, and writes backend code — all in one loop.

Phase 5A breaks this into **six independent cognitive nodes**, each with:
- A single, focused responsibility
- A unique system prompt
- A defined input artifact (what it consumes)
- A defined output artifact (what it produces)
- Its own Inngest function with independent retries
- Its own runtime observability events

The nodes are:

```
Architect  →  Researcher  →  PRD Reviewer  →  Staff Engineer  →  FE Engineer
                                                                →  BE Engineer
```

Each arrow represents an **artifact transition**, not a prompt. The artifact is the contract.
The workflow coordinator — a lightweight Inngest function — drives these transitions.

This is the first phase where we can truthfully say the HCR pipeline exists.

---

## 2. Current State Audit

### 2.1 What Exists (Phase 4)

**Cognitive layer:**
- `src/cognition/context-engine.ts` — builds LLM message arrays
- `src/cognition/discovery-agent.ts` — discovery-phase question loop
- `src/cognition/llm.ts` — raw fetch to OpenRouter
- `src/cognition/system-prompt.ts` — single monolithic system prompt

**Runtime layer:**
- `src/runtime/workflows/hcr/start-hcr-workflow.ts` — creates Workflow + Execution + single ARCHITECT Node in DB
- `src/runtime/workflows/discovery/` — discovery workflow
- `src/runtime/artifacts/create-artifact.ts` — generic artifact creator
- `src/runtime/artifacts/get-artifact.ts` — artifact reader

**Inngest functions:**
- `app/inngest/functions/hcr-agent.ts` — **the monolithic agent** (3 step.run calls: context, agent loop, finalize)
- `app/inngest/functions/embedFile.ts` — embedding pipeline

**Tool layer:**
- `lib/tools.ts` — 5 tools: create_file, edit_file, read_file, delete_file, mark_complete
- `lib/tool-executor.ts` — tool dispatch
- `lib/handleFailure.ts` — marks workflow/execution/node FAILED
- `lib/toolCompletion.ts` — emits tool.completed runtime event

**Database enums (current):**
```
NodeType:       DISCOVERY | ARCHITECT | RESEARCH | PRD_REVIEWER | PLANNER | FRONTEND_ENG | BACKEND_ENG | WORKER | TEST_DESIGNER | QA | REPAIR
ArtifactType:   DISCOVERY_REQUIREMENT | ARCHITECTURE_SPEC | RESEARCH_DOSSIER | APPROVED_PRD | EXECUTION_PLAN
WorkflowType:   DISCOVERY | HCR
ProjectStatus:  DISCOVERY | PENDING | IN_PROGRESS | IDLE | FAILED
```

### 2.2 Current Execution Flow

```
POST /api/projects/[id]/chat
        ↓
startHCRWorkflow()           ← creates Workflow(HCR) + Execution + Node(ARCHITECT)
        ↓
inngest.send("chat/requested")
        ↓
hcrAgentFunction (Inngest)
  step.run("fetch_initial_context")    ← DB queries
  step.run("agent-loop")               ← single while loop, all cognition here
    - getEmbeddings(prompt)
    - buildContext(...)                ← injects DISCOVERY_REQUIREMENT artifact
    - callLLM(messages, tools)
    - executeTool(...)
    - repeat until mark_complete or MAX_ITERATIONS
  step.run("finalize")                 ← sets project status = IDLE
```

### 2.3 Problems with Current State

| Problem | Impact |
|---|---|
| Single node does everything | No cognitive specialization; prompt pollution |
| System prompt tries to be all roles | Lower quality output per role |
| No artifact chain | Can't replay/inspect intermediate cognitive outputs |
| One Inngest function = one retry boundary | One bad tool call can kill the whole run |
| No workflow coordinator | Can't add new nodes without rewriting the agent |
| ARCHITECT node hardcoded in `startHCRWorkflow` | Not composable |
| Context window bloated | All artifacts injected at once; irrelevant to the current node |

---

## 3. Target State

### 3.1 Target Execution Flow

```
POST /api/projects/[id]/chat
        ↓
startHCRWorkflow()     ← creates Workflow(HCR) + Execution + Node(ARCHITECT, order=1)
        ↓
inngest.send("chat/requested")
        ↓
architect-node function
  consumes: DISCOVERY_REQUIREMENT artifact
  produces: ARCHITECTURE_SPEC artifact
  emits:    "node/completed" { nodeType: ARCHITECT, artifactId }
        ↓
workflow-coordinator function (triggered by "node/completed")
  reads: node type from event
  creates: next Node in DB (RESEARCHER, order=2)
  emits:  "node/execute" { nodeType: RESEARCHER, ... }
        ↓
researcher-node function
  consumes: ARCHITECTURE_SPEC artifact
  produces: RESEARCH_DOSSIER artifact
  emits:    "node/completed" { nodeType: RESEARCHER, artifactId }
        ↓
workflow-coordinator
  creates: Node(PRD_REVIEWER, order=3)
  emits:  "node/execute" { nodeType: PRD_REVIEWER, ... }
        ↓
prd-reviewer-node function
  consumes: RESEARCH_DOSSIER artifact
  produces: APPROVED_PRD artifact
  emits:    "node/completed" { nodeType: PRD_REVIEWER, artifactId }
        ↓
workflow-coordinator
  creates: Node(STAFF_ENGINEER, order=4)
  emits:  "node/execute" { nodeType: STAFF_ENGINEER, ... }
        ↓
staff-engineer-node function
  consumes: APPROVED_PRD artifact
  produces: EXECUTION_PLAN artifact
  emits:    "node/completed" { nodeType: STAFF_ENGINEER, artifactId }
        ↓
workflow-coordinator
  creates: Node(FRONTEND_ENGINEER, order=5) + Node(BACKEND_ENGINEER, order=6)
  emits:  "node/execute" (x2, one per node type)
        ↓
[PARALLEL]
frontend-engineer-node              backend-engineer-node
  consumes: EXECUTION_PLAN            consumes: EXECUTION_PLAN
  produces: file mutations            produces: file mutations
  emits: "node/completed"             emits: "node/completed"
        ↓
workflow-coordinator (both completions)
  all nodes complete → mark Execution COMPLETED → mark Workflow COMPLETED
  set project status = IDLE
```

### 3.2 What Changes vs What Stays

**Stays unchanged:**
- Discovery phase (routes, agent, artifacts) — no touch
- `lib/tool-executor.ts` — file tools work as-is
- `lib/tools.ts` — same 5 tools
- `src/runtime/artifacts/create-artifact.ts` — reused as-is
- Embedding pipeline (`embedFile.ts`)
- Auth layer, API routes (except `/api/projects/[id]/chat` gets a minor update)
- `startHCRWorkflow()` — updated to create ARCHITECT node as first node

**Changes:**
- `hcr-agent.ts` → **replaced** by a set of node functions + coordinator
- `src/cognition/system-prompt.ts` → moved inside Agent Registry
- `src/cognition/context-engine.ts` → generalized to accept a `NodeConfig`
- `startHCRWorkflow` → minor update (see section 10)

**New:**
- `src/cognition/nodes/` — one file per node type
- `src/cognition/node-executor.ts` — shared execution engine
- `src/cognition/agent-registry.ts` — registry of all node configs
- `app/inngest/functions/workflow-coordinator.ts` — transition logic
- `app/inngest/functions/nodes/` — one inngest function per node

---

## 4. Core Architectural Principles

These must be understood before writing a single line of code.

### 4.1 Artifacts are the contract, not prompts

Each node consumes a **typed artifact** and produces a **typed artifact**.
Nodes do NOT communicate via prompts passed between them.
The artifact is the durable, versionable, inspectable output.

### 4.2 Nodes are stateless execution units

A node function receives everything it needs in its inngest event payload:
- `projectId`, `userId`
- `workflowId`, `executionId`, `nodeId`
- The ID of the artifact it should consume

It reads its input artifact from the DB. It writes its output artifact to the DB. It fires an event. Done.

### 4.3 The coordinator is dumb

The workflow coordinator does NOT contain business logic about what each node does.
It only knows: "Node X completed → create Node Y → fire event."
The transition map is a data structure, not code branching.

### 4.4 Every node has independent retry boundaries

Each Inngest function has `retries: 3` independently.
If RESEARCHER fails, ARCHITECT's output is preserved. RESEARCHER retries from its artifact input.

### 4.5 Context is scoped per node

Each node gets ONLY the artifacts and files relevant to its work.
The Researcher does NOT get the file tree. The FE Engineer does NOT get the ArchitectureSpec (unless the ExecutionPlan surfaces it).
The `buildContext` function is parameterized by `NodeConfig.contextConfig`.

### 4.6 No tools for non-code nodes

Architect, Researcher, PRD Reviewer, Staff Engineer — these produce **artifacts** only.
They call the LLM once (or a few times in a loop if needed) and write a structured JSON artifact.
They do NOT call `create_file` or `edit_file`.
Only Frontend Engineer and Backend Engineer call file tools.

---

## 5. Database Schema Changes

### 5.1 ArtifactType enum values

```prisma
enum ArtifactType {
  DISCOVERY_REQUIREMENT
  ARCHITECTURE_SPEC
  RESEARCH_DOSSIER
  APPROVED_PRD
  EXECUTION_PLAN
  // Note: FE/BE Engineers produce file mutations, NOT artifacts
  // They write directly to the File table. No new ArtifactType needed.
}
```

**Why no artifact type for FE/BE mutations?**
FE and BE engineers produce file system changes via `create_file`/`edit_file`.
The File table IS their artifact. Creating a separate ArtifactType for file content would duplicate state.
The runtime events (`tool.called`, `tool.completed`) provide observability.

## 6. Deliverable 1 — Node Executor Framework

### 6.1 What it is

A shared function `executeNode()` that all 6 cognitive node Inngest functions call.
It handles:
- Marking the node as RUNNING
- Emitting `node.running` runtime event
- Calling the LLM (once or in a loop)
- Writing the output artifact
- Emitting `artifact.created` runtime event
- Marking the node as COMPLETED
- Emitting `node.completed` runtime event
- Emitting the Inngest `node/completed` event to trigger the coordinator
- Error handling → marks node FAILED

### 6.2 NodeConfig type

Create `src/cognition/types/node-config.ts`:

```typescript
import { NodeType, ArtifactType } from "@prisma/client";
import { LLmMessage } from "@/src/shared/types";

export type ContextConfig = {
  // Which artifact types to fetch and inject into context
  consumedArtifactTypes: ArtifactType[];
  // Whether to include the project file tree
  includeFileTree: boolean;
  // Whether to run vector search for relevant files
  includeVectorSearch: boolean;
  // Whether to include recent message history (BUILD phase)
  includeMessageHistory: boolean;
};

export type NodeConfig = {
  nodeType: NodeType;
  // The artifact type this node produces
  outputArtifactType: ArtifactType | null;   // null for FE/BE (they produce files)
  // The artifact type(s) this node consumes
  consumedArtifactTypes: ArtifactType[];
  // The system prompt for this node
  systemPrompt: string;
  // Context assembly rules
  contextConfig: ContextConfig;
  // Whether this node uses file tools (create_file, edit_file, etc.)
  usesFileTools: boolean;
  // Max iterations for the agentic loop (only relevant for file-tool nodes)
  maxIterations: number;
  // Whether output should be JSON (for artifact-producing nodes)
  // or freeform tool calls (for file-producing nodes)
  outputMode: "structured_json" | "tool_calls";
};
```

### 6.3 executeNode() signature

Create `src/cognition/node-executor.ts`:

```typescript
import { NodeConfig } from "./types/node-config";
import { ArtifactType, NodeType } from "@prisma/client";
import { inngest } from "@/app/inngest/client";
import { prisma } from "@/lib/prisma";
import { callLLM } from "./llm";
import { buildNodeContext } from "./context-engine";
import { createArtifact } from "@/src/runtime/artifacts/create-artifact";
import { executeTool } from "@/lib/tool-executor";
import { tools } from "@/lib/tools";
import { getEmbeddings } from "@/lib/embeddings";

export interface ExecuteNodeInput {
  projectId: string;
  userId: string;
  workflowId: string;
  executionId: string;
  nodeId: string;
  prompt: string;            // The original user prompt (always passed through)
  nodeConfig: NodeConfig;
}

export interface ExecuteNodeResult {
  artifactId: string | null;  // null if node produced file mutations
  nodeType: NodeType;
  workflowId: string;
  executionId: string;
  projectId: string;
  userId: string;
  prompt: string;
}

export async function executeNode(input: ExecuteNodeInput): Promise<ExecuteNodeResult> {
  // 1. Mark node RUNNING + emit event
  // 2. Fetch consumed artifacts from DB
  // 3. Build context via buildNodeContext()
  // 4. If outputMode === "structured_json": call LLM once, parse JSON, createArtifact()
  // 5. If outputMode === "tool_calls": run agentic loop with file tools
  // 6. Mark node COMPLETED + emit events
  // 7. Fire inngest "node/completed" event
  // 8. Return result
}
```

### 6.4 Structured JSON flow (Architect, Researcher, PRD Reviewer, Staff Engineer)

```
buildNodeContext()
        ↓
callLLM(messages, [])         ← NO tools; empty tools array
        ↓
response.choices[0].message.content   ← expect valid JSON string
        ↓
JSON.parse(content)
        ↓
validate shape (basic key checks; throw if invalid)
        ↓
createArtifact({ type: nodeConfig.outputArtifactType, content: parsedJson })
        ↓
emit "node/completed" inngest event with artifactId
```

**Important:** The system prompt for structured-JSON nodes MUST instruct the LLM to return ONLY valid JSON, no preamble, no markdown fences. This is the same pattern already used in `callDiscoveryAgent`.

**Retry on parse failure:** If `JSON.parse` throws, retry the LLM call up to 2 times with an appended user message: `"Your previous response was not valid JSON. Return ONLY the JSON object with no surrounding text."` Track retries locally inside `executeNode`, not via Inngest retries (LLM parse failures shouldn't count as function failures).

### 6.5 Tool call flow (Frontend Engineer, Backend Engineer)

This is nearly identical to the current `hcr-agent.ts` agent loop. The key differences:
- System prompt is role-specific (see section 12)
- Context is scoped (only ExecutionPlan artifact + file tree + vector search)
- `maxIterations` from `NodeConfig`
- When `mark_complete` is called → node completes without producing an artifact (writes `null` for `artifactId`)

---

## 7. Deliverable 2 — Agent Registry

### 7.1 What it is

A single source of truth for all cognitive node configurations.

Create `src/cognition/agent-registry.ts`:

```typescript
import { NodeType, ArtifactType } from "@prisma/client";
import { NodeConfig } from "./types/node-config";
import {
  ARCHITECT_SYSTEM_PROMPT,
  RESEARCHER_SYSTEM_PROMPT,
  PRD_REVIEWER_SYSTEM_PROMPT,
  STAFF_ENGINEER_SYSTEM_PROMPT,
  FRONTEND_ENGINEER_SYSTEM_PROMPT,
  BACKEND_ENGINEER_SYSTEM_PROMPT,
} from "./prompts";   // one file per prompt, see section 12

export const AGENT_REGISTRY: Record<NodeType, NodeConfig> = {
  [NodeType.DISCOVERY]: { /* ... handled separately, not part of HCR */ },

  [NodeType.ARCHITECT]: {
    nodeType: NodeType.ARCHITECT,
    outputArtifactType: ArtifactType.ARCHITECTURE_SPEC,
    consumedArtifactTypes: [ArtifactType.DISCOVERY_REQUIREMENT],
    systemPrompt: ARCHITECT_SYSTEM_PROMPT,
    contextConfig: {
      consumedArtifactTypes: [ArtifactType.DISCOVERY_REQUIREMENT],
      includeFileTree: false,
      includeVectorSearch: false,
      includeMessageHistory: false,
    },
    usesFileTools: false,
    maxIterations: 1,
    outputMode: "structured_json",
  },

  [NodeType.RESEARCHER]: {
    nodeType: NodeType.RESEARCHER,
    outputArtifactType: ArtifactType.RESEARCH_DOSSIER,
    consumedArtifactTypes: [ArtifactType.ARCHITECTURE_SPEC],
    systemPrompt: RESEARCHER_SYSTEM_PROMPT,
    contextConfig: {
      consumedArtifactTypes: [ArtifactType.ARCHITECTURE_SPEC],
      includeFileTree: false,
      includeVectorSearch: false,
      includeMessageHistory: false,
    },
    usesFileTools: false,
    maxIterations: 1,
    outputMode: "structured_json",
  },

  [NodeType.PRD_REVIEWER]: {
    nodeType: NodeType.PRD_REVIEWER,
    outputArtifactType: ArtifactType.APPROVED_PRD,
    consumedArtifactTypes: [ArtifactType.RESEARCH_DOSSIER],
    systemPrompt: PRD_REVIEWER_SYSTEM_PROMPT,
    contextConfig: {
      consumedArtifactTypes: [ArtifactType.RESEARCH_DOSSIER],
      includeFileTree: false,
      includeVectorSearch: false,
      includeMessageHistory: false,
    },
    usesFileTools: false,
    maxIterations: 1,
    outputMode: "structured_json",
  },

  [NodeType.STAFF_ENGINEER]: {
    nodeType: NodeType.STAFF_ENGINEER,
    outputArtifactType: ArtifactType.EXECUTION_PLAN,
    consumedArtifactTypes: [ArtifactType.APPROVED_PRD],
    systemPrompt: STAFF_ENGINEER_SYSTEM_PROMPT,
    contextConfig: {
      consumedArtifactTypes: [ArtifactType.APPROVED_PRD],
      includeFileTree: false,
      includeVectorSearch: false,
      includeMessageHistory: false,
    },
    usesFileTools: false,
    maxIterations: 1,
    outputMode: "structured_json",
  },

  [NodeType.FRONTEND_ENGINEER]: {
    nodeType: NodeType.FRONTEND_ENGINEER,
    outputArtifactType: null,                          // produces files, not artifacts
    consumedArtifactTypes: [ArtifactType.EXECUTION_PLAN],
    systemPrompt: FRONTEND_ENGINEER_SYSTEM_PROMPT,
    contextConfig: {
      consumedArtifactTypes: [ArtifactType.EXECUTION_PLAN],
      includeFileTree: true,
      includeVectorSearch: true,
      includeMessageHistory: false,
    },
    usesFileTools: true,
    maxIterations: 20,
    outputMode: "tool_calls",
  },

  [NodeType.BACKEND_ENGINEER]: {
    nodeType: NodeType.BACKEND_ENGINEER,
    outputArtifactType: null,
    consumedArtifactTypes: [ArtifactType.EXECUTION_PLAN],
    systemPrompt: BACKEND_ENGINEER_SYSTEM_PROMPT,
    contextConfig: {
      consumedArtifactTypes: [ArtifactType.EXECUTION_PLAN],
      includeFileTree: true,
      includeVectorSearch: true,
      includeMessageHistory: false,
    },
    usesFileTools: true,
    maxIterations: 20,
    outputMode: "tool_calls",
  },
};
```

### 7.2 How it's used

Every Inngest node function does exactly this:

```typescript
import { AGENT_REGISTRY } from "@/src/cognition/agent-registry";
import { executeNode } from "@/src/cognition/node-executor";

export const architectNodeFunction = inngest.createFunction(
  { id: "architect-node", retries: 3, triggers: [{ event: "node/execute" }] },
  async ({ event, step }) => {
    // Guard: only handle ARCHITECT events
    if (event.data.nodeType !== NodeType.ARCHITECT) return;

    const result = await step.run("execute-architect", async () => {
      return executeNode({
        ...event.data,
        nodeConfig: AGENT_REGISTRY[NodeType.ARCHITECT],
      });
    });

    return result;
  }
);
```

**Alternative approach** (preferred for cleanliness): Use a single `node-router` Inngest function that reads `event.data.nodeType`, looks up `AGENT_REGISTRY`, and calls `executeNode`. See section 11 for the decision and tradeoffs.

---

## 8. Deliverable 3 — Artifact Contracts

All artifact `content` shapes are defined as TypeScript interfaces. These are the contracts.
They live in `src/cognition/types/artifacts.ts`.

### 8.1 DiscoveryRequirement (existing, do not change)

```typescript
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
```

### 8.2 ArchitectureSpec (NEW — produced by Architect)

```typescript
export interface ArchitectureSpec {
  projectUnderstanding: {
    oneLiner: string;              // "A task management app for remote teams"
    coreValue: string;             // What problem it solves
    targetUser: string;
    successCriteria: string[];     // How we know it's done
  };
  architectureDecisions: {
    pattern: string;               // "SPA with REST API", "SSR with server actions", etc.
    reasoning: string;
    tradeoffs: string[];
  };
  systemBoundaries: {
    frontend: string;              // What lives in the frontend
    backend: string;               // What lives in the backend
    database: string;              // Data storage approach
    externalServices: string[];    // Third-party integrations
  };
  majorImplementationAreas: string[];  // High-level list: auth, dashboard, API, etc.
  executionStrategy: string;           // "Build auth first, then core features, then UI polish"
  risksIdentified: string[];
}
```

### 8.3 ResearchDossier (NEW — produced by Researcher)

```typescript
export interface ResearchDossier {
  frameworkRecommendations: {
    name: string;
    version: string;
    justification: string;
    alternatives: string[];
  }[];
  implementationPatterns: {
    area: string;                  // e.g., "Authentication", "State Management"
    recommendedPattern: string;    // e.g., "JWT with refresh tokens"
    codePattern: string;           // Pseudocode or pattern description
    reasoning: string;
  }[];
  libraryChoices: {
    library: string;
    purpose: string;
    installCommand: string;
    justification: string;
  }[];
  technicalFindings: string[];     // Free-form key findings
  risks: {
    description: string;
    severity: "low" | "medium" | "high";
    mitigation: string;
  }[];
  projectStructure: {
    directories: string[];         // Recommended folder structure
    namingConventions: string;
  };
}
```

### 8.4 ApprovedPRD (NEW — produced by PRD Reviewer)

```typescript
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
```

### 8.5 ExecutionPlan (NEW — produced by Staff Engineer)

```typescript
export interface ExecutionPlan {
  frontendTasks: {
    id: string;                    // "FE-001"
    title: string;
    description: string;
    filesToCreate: string[];       // Exact file paths
    filesToModify: string[];
    dependencies: string[];        // Other task IDs this depends on
    estimatedLines: number;
    acceptanceCriteria: string[];
  }[];
  backendTasks: {
    id: string;                    // "BE-001"
    title: string;
    description: string;
    filesToCreate: string[];
    filesToModify: string[];
    dependencies: string[];
    estimatedLines: number;
    acceptanceCriteria: string[];
  }[];
  sharedTasks: {                   // Tasks both FE and BE need to know about
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
    rootFiles: string[];           // package.json, vite.config.js, etc.
    directories: string[];
  };
  dependencyInstallCommands: string[];   // npm install commands (FE/BE will embed in package.json)
}
```

### 8.6 Important: Artifact Validation

When `executeNode` receives the LLM output for a structured-JSON node, it MUST validate:

1. `JSON.parse()` succeeds
2. The required top-level keys exist (check against the interface above)
3. Arrays are actually arrays (not strings)

If validation fails after 3 retry attempts, throw an error to trigger Inngest retry.

Create `src/cognition/types/artifact-validators.ts` with simple key-presence validators for each artifact type.

---

## 9. Deliverable 4 — Artifact-Driven Workflow Progression

### 9.1 The Transition Map

Every artifact type maps to the next node type to execute. This lives in the coordinator.

```typescript
// src/runtime/workflows/hcr/transition-map.ts

import { ArtifactType, NodeType } from "@prisma/client";

type TransitionEntry = {
  nextNodes: NodeType[];     // Usually 1, except EXECUTION_PLAN which spawns 2
  order: number;             // Node order in the execution
};

export const HCR_TRANSITION_MAP: Partial<Record<ArtifactType, TransitionEntry>> = {
  [ArtifactType.ARCHITECTURE_SPEC]: {
    nextNodes: [NodeType.RESEARCHER],
    order: 2,
  },
  [ArtifactType.RESEARCH_DOSSIER]: {
    nextNodes: [NodeType.PRD_REVIEWER],
    order: 3,
  },
  [ArtifactType.APPROVED_PRD]: {
    nextNodes: [NodeType.STAFF_ENGINEER],
    order: 4,
  },
  [ArtifactType.EXECUTION_PLAN]: {
    nextNodes: [NodeType.FRONTEND_ENGINEER, NodeType.BACKEND_ENGINEER],
    order: 5,                // Both get order 5 (parallel)
  },
};
```

### 9.2 Why this pattern

The coordinator does NOT hardcode: `if (nodeType === ARCHITECT) trigger RESEARCHER`.
Instead, it reads the **artifact type** produced and looks it up in the transition map.
Adding a new node in the future = one new entry in the map + one new NodeType/ArtifactType enum value + one new Inngest function. No other files change.

### 9.3 Artifact ID threading

Every Inngest event in the HCR pipeline carries the artifact ID consumed by the current node. This means any node can reconstruct its full artifact chain by following: `node.id → artifact.nodeId → node.id → artifact.nodeId`.

The `node/execute` event payload:

```typescript
type NodeExecuteEvent = {
  name: "node/execute";
  data: {
    projectId: string;
    userId: string;
    workflowId: string;
    executionId: string;
    nodeId: string;
    nodeType: NodeType;
    prompt: string;
    inputArtifactId: string | null;   // null only for ARCHITECT (reads DISCOVERY_REQUIREMENT by type)
  };
};
```

The `node/completed` event payload:

```typescript
type NodeCompletedEvent = {
  name: "node/completed";
  data: {
    projectId: string;
    userId: string;
    workflowId: string;
    executionId: string;
    nodeType: NodeType;
    outputArtifactId: string | null;   // null for FE/BE
    outputArtifactType: ArtifactType | null;
    prompt: string;
  };
};
```

---

## 10. Deliverable 5 — Workflow State Progression & Coordinator

### 10.1 Updated startHCRWorkflow

`src/runtime/workflows/hcr/start-hcr-workflow.ts` — minor change only:

- Creates `Node(ARCHITECT, order=1, status=CREATED)` — same as before
- Does NOT create nodes for subsequent stages (coordinator handles that)
- Fires `inngest.send("node/execute", { nodeType: ARCHITECT, inputArtifactId: null, ... })`
  (instead of the current `"chat/requested"` event — see API route update in section 10.3)

### 10.2 The Workflow Coordinator

Create `app/inngest/functions/workflow-coordinator.ts`:

```typescript
export const workflowCoordinatorFunction = inngest.createFunction(
  { id: "workflow-coordinator", retries: 2, triggers: [{ event: "node/completed" }] },
  async ({ event, step }) => {
    const { outputArtifactType, workflowId, executionId, projectId, userId, prompt } = event.data;

    await step.run("coordinate-next-node", async () => {
      // 1. Lookup transition map
      const transition = HCR_TRANSITION_MAP[outputArtifactType];
      if (!transition) {
        // No next node = all done. Finalize.
        await finalizeWorkflow(workflowId, executionId, projectId);
        return;
      }

      // 2. Check if we're in a parallel completion scenario (FE+BE)
      // Both FE and BE produce no artifact, so outputArtifactType is null for them.
      // Need a separate check: are all nodes for this execution complete?
      if (outputArtifactType === null) {
        const runningNodes = await prisma.node.count({
          where: { executionId, status: { in: [NodeStatus.CREATED, NodeStatus.RUNNING] } }
        });
        if (runningNodes > 0) return;  // Wait for the other parallel node
        await finalizeWorkflow(workflowId, executionId, projectId);
        return;
      }

      // 3. Create next nodes in DB
      const nextNodeIds: string[] = [];
      for (const nodeType of transition.nextNodes) {
        const node = await prisma.node.create({
          data: { executionId, type: nodeType, status: NodeStatus.CREATED, order: transition.order },
        });
        nextNodeIds.push(node.id);

        // 4. Emit node.created runtime event
        await prisma.runtimeEvent.create({
          data: { executionId, nodeId: node.id, type: "node.created",
            payload: { nodeId: node.id, nodeType } }
        });

        // 5. Fire node/execute inngest event
        await inngest.send({
          name: "node/execute",
          data: {
            projectId, userId, workflowId, executionId,
            nodeId: node.id, nodeType, prompt,
            inputArtifactId: event.data.outputArtifactId,
          },
        });
      }
    });
  }
);

async function finalizeWorkflow(workflowId: string, executionId: string, projectId: string) {
  await prisma.execution.update({ where: { id: executionId }, data: { status: ExecutionStatus.COMPLETED } });
  await prisma.workflow.update({ where: { id: workflowId }, data: { status: WorkflowStatus.COMPLETED } });
  await prisma.project.update({ where: { id: projectId }, data: { status: ProjectStatus.IDLE } });
  await prisma.runtimeEvent.createMany({
    data: [
      { executionId, type: "execution.completed", payload: { executionId } },
      { executionId, type: "workflow.completed", payload: { workflowId } },
    ],
  });
}
```

### 10.3 API Route Update

`app/api/projects/[id]/chat/route.ts` — change the inngest.send call:

**Before:**
```typescript
await inngest.send({ name: "chat/requested", data: { projectId, prompt, userId, workflowId, executionId, nodeId } });
```

**After:**
```typescript
await inngest.send({
  name: "node/execute",
  data: {
    projectId, userId, workflowId, executionId,
    nodeId,
    nodeType: NodeType.ARCHITECT,
    prompt,
    inputArtifactId: null,  // Architect reads DISCOVERY_REQUIREMENT by type lookup
  }
});
```

Remove the `"chat/requested"` trigger. **The old `hcr-agent.ts` inngest function must remain registered until all in-flight workflows using `"chat/requested"` are complete**, then it can be removed. During the migration period, keep both registered.

### 10.4 Register new functions in inngest route

`app/api/inngest/route.ts` — add all new functions:

```typescript
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    hcrAgentFunction,           // Keep until migration complete
    workflowCoordinatorFunction,
    architectNodeFunction,
    researcherNodeFunction,
    prdReviewerNodeFunction,
    staffEngineerNodeFunction,
    frontendEngineerNodeFunction,
    backendEngineerNodeFunction,
    embedFileFunction,
  ],
});
```

---

## 11. Inngest Function Architecture

### 11.1 Decision: Single Router vs Individual Functions

**Option A: One function per node type** (6 functions, each filters by `event.data.nodeType`)
**Option B: Single `node-executor` function** (one function, routes internally)

**Recommendation: Option A (one function per node type)**

**Reasoning:**
- Inngest treats each function independently for retry configuration
- Cleaner failure attribution in Inngest dashboard (you see "researcher-node failed" not "node-executor failed")
- Each function can have different `retries` counts if needed
- Easier to add node-specific middleware or concurrency limits later

**The guard pattern** (prevents double-execution if both `"node/execute"` event reaches all 6 functions):

```typescript
// Every node function starts with this guard
if (event.data.nodeType !== NodeType.ARCHITECT) return;
```

Alternatively, use Inngest's `filter` trigger option if supported by your version:
```typescript
triggers: [{ event: "node/execute", expression: "event.data.nodeType == 'ARCHITECT'" }]
```
Check Inngest 4.x docs for `expression` support. If available, use it — cleaner than runtime guards.

### 11.2 Function Definitions

Create in `app/inngest/functions/nodes/`:

- `architect-node.ts`
- `researcher-node.ts`
- `prd-reviewer-node.ts`
- `staff-engineer-node.ts`
- `frontend-engineer-node.ts`
- `backend-engineer-node.ts`

Each file is ~20 lines. They all follow this template:

```typescript
import { inngest } from "../../client";
import { NodeType } from "@prisma/client";
import { AGENT_REGISTRY } from "@/src/cognition/agent-registry";
import { executeNode } from "@/src/cognition/node-executor";

export const [nodeType]NodeFunction = inngest.createFunction(
  {
    id: "[node-type]-node",
    retries: 3,
    onFailure: async ({ event }) => {
      const { executionId, nodeId, workflowId } = event.data.event.data;
      await handleFailure(executionId, nodeId, workflowId);
    },
    triggers: [{ event: "node/execute" }],
  },
  async ({ event, step }) => {
    if (event.data.nodeType !== NodeType.[NODE_TYPE]) return;

    const result = await step.run("execute-[node-type]", async () => {
      return executeNode({
        ...event.data,
        nodeConfig: AGENT_REGISTRY[NodeType.[NODE_TYPE]],
      });
    });

    return result;
  }
);
```

---

## 12. System Prompts Per Node

Each node's system prompt is a single-responsibility instruction set. Create them in `src/cognition/prompts/`:

### 12.1 architect-prompt.ts

**Responsibility:** Translate discovery requirements into an architectural blueprint.
**Input:** DiscoveryRequirement artifact
**Output:** ArchitectureSpec JSON

Key instructions to include:
- You are a principal architect. You do NOT write code. You design.
- Read the discovery requirements carefully.
- Decide the architectural pattern (SPA, SSR, MVC, etc.) and justify it.
- Define system boundaries: what belongs in frontend, backend, database.
- Identify the 5-8 major implementation areas.
- Identify risks.
- Output ONLY valid JSON matching the ArchitectureSpec schema. No preamble. No markdown.
- Embed the exact JSON schema as a comment in the prompt so the LLM knows the expected shape.

### 12.2 researcher-prompt.ts

**Responsibility:** Research implementation patterns, frameworks, and libraries.
**Input:** ArchitectureSpec artifact
**Output:** ResearchDossier JSON

Key instructions:
- You are a senior engineer who researches technical implementation options.
- You do NOT write code. You research and recommend.
- For each major implementation area in the ArchitectureSpec, recommend specific frameworks/libraries.
- Include concrete version numbers where possible.
- Identify implementation patterns (not abstract patterns — concrete ones like "use Zod for validation, Prisma for ORM").
- Flag technical risks with severity.
- Recommend a project folder structure.
- Output ONLY valid JSON matching the ResearchDossier schema.

### 12.3 prd-reviewer-prompt.ts

**Responsibility:** Validate requirements, resolve ambiguities, scope the work.
**Input:** ResearchDossier artifact (which contains ArchitectureSpec context)
**Output:** ApprovedPRD JSON

Key instructions:
- You are a product manager and requirements engineer.
- Review the requirements and research. Identify anything that's ambiguous, over-scoped, or contradictory.
- For every ambiguity: choose the simplest reasonable default and document the decision.
- Classify every feature as must-have / should-have / nice-to-have.
- Define what's explicitly out of scope.
- Create an implementation-ready phased plan.
- Output ONLY valid JSON matching the ApprovedPRD schema.

### 12.4 staff-engineer-prompt.ts

**Responsibility:** Decompose approved requirements into concrete engineering tasks.
**Input:** ApprovedPRD artifact
**Output:** ExecutionPlan JSON

Key instructions:
- You are a staff engineer doing technical task decomposition.
- Break down every approved feature into atomic engineering tasks.
- Separate clearly: frontend tasks vs backend tasks.
- For each task: specify exact file paths to create or modify.
- Define dependency ordering between tasks.
- Specify the project directory structure and which root config files are needed.
- Output ONLY valid JSON matching the ExecutionPlan schema.
- Be specific about file paths — use the same conventions recommended in the ResearchDossier.

### 12.5 frontend-engineer-prompt.ts

**Responsibility:** Execute frontend tasks from the execution plan.
**Input:** ExecutionPlan artifact (injected into context)
**Output:** File mutations (create_file, edit_file calls)

Key instructions (largely similar to current system prompt but scoped):
- You are a senior frontend engineer. You build UI.
- You have access to: the execution plan, the file tree, relevant existing files.
- Work through the frontend tasks listed in the execution plan, in dependency order.
- Use React + Vite + Tailwind CSS.
- Call create_file and edit_file. Never output raw code.
- Read files before editing them.
- When all frontend tasks from the plan are complete, call mark_complete.
- Do NOT implement backend tasks. Ignore them.

### 12.6 backend-engineer-prompt.ts

**Responsibility:** Execute backend tasks from the execution plan.
**Input:** ExecutionPlan artifact
**Output:** File mutations

Similar to frontend but scoped to backend tasks. Include instructions about:
- Node.js patterns, Express/Hono/Next API routes depending on the plan
- Database schema files, migration files
- API endpoint files
- Service layer files
- Do NOT implement frontend tasks.

---

## 13. Context Engine Adaptation Per Node

### 13.1 Refactor buildContext → buildNodeContext

`src/cognition/context-engine.ts` currently has a fixed signature.
Refactor to accept `NodeConfig.contextConfig`:

```typescript
export async function buildNodeContext(
  input: {
    projectId: string;
    nodeConfig: NodeConfig;
    prompt: string;
    promptEmbedding: number[];
    files: { id: string; path: string; embeddingStatus: string }[];
    messages: { role: string; content: string }[];
    toolHistory: ToolHistoryEntry[];
    currentScratchpad: string[];
    inputArtifactContent: Record<string, unknown> | null;
  }
): Promise<LLmMessage[]>
```

Inside `buildNodeContext`:

1. **System message** — from `nodeConfig.systemPrompt`
2. **Artifact context** — fetch and inject only `nodeConfig.contextConfig.consumedArtifactTypes`
3. **File tree** — only if `nodeConfig.contextConfig.includeFileTree === true`
4. **Vector search** — only if `nodeConfig.contextConfig.includeVectorSearch === true`
5. **Message history** — only if `nodeConfig.contextConfig.includeMessageHistory === true`
6. **Scratchpad** — only for tool-call nodes (`outputMode === "tool_calls"`)
7. **Tool history** — only for tool-call nodes
8. **Current user prompt** — always last

### 13.2 Backward compatibility

The old `buildContext` function can be deleted — it was only used by `hcr-agent.ts` which is being replaced.
The new `buildNodeContext` is used by `executeNode`.

---

## 14. Tool Access Matrix

| Node | create_file | edit_file | read_file | delete_file | mark_complete |
|---|---|---|---|---|---|
| Architect | ✗ | ✗ | ✗ | ✗ | ✗ |
| Researcher | ✗ | ✗ | ✗ | ✗ | ✗ |
| PRD Reviewer | ✗ | ✗ | ✗ | ✗ | ✗ |
| Staff Engineer | ✗ | ✗ | ✗ | ✗ | ✗ |
| Frontend Engineer | ✓ | ✓ | ✓ | ✓ | ✓ |
| Backend Engineer | ✓ | ✓ | ✓ | ✓ | ✓ |

For structured-JSON nodes, `callLLM` is called with `tools = []` (empty array).
For tool-call nodes, `callLLM` is called with the full `tools` array.

The `mark_complete` behavior for FE/BE nodes:
When the FE Engineer calls `mark_complete`, `executeNode` should:
1. Call `executeTool("mark_complete", ...)` — which currently updates ProjectMemory + Node status
2. Emit `node/completed` with `outputArtifactId: null`, `outputArtifactType: null`
3. The coordinator sees null artifact type → checks for remaining nodes → finalizes if all done

**Loophole:** The current `markComplete` in `tool-executor.ts` sets project status to IDLE. This must NOT happen in Phase 5A — status management is the coordinator's job. Remove the `prisma.project.update({ status: IDLE })` from `markComplete`. The coordinator's `finalizeWorkflow` handles it.

---

## 15. File & Folder Structure

```
src/
  cognition/
    node-executor.ts             ← NEW: shared execution engine
    agent-registry.ts            ← NEW: registry of all node configs
    context-engine.ts            ← UPDATED: refactored to buildNodeContext
    discovery-agent.ts           ← UNCHANGED
    llm.ts                       ← UNCHANGED
    system-prompt.ts             ← DELETE (replaced by per-node prompts)
    prompts/
      architect-prompt.ts        ← NEW
      researcher-prompt.ts       ← NEW
      prd-reviewer-prompt.ts     ← NEW
      staff-engineer-prompt.ts   ← NEW
      frontend-engineer-prompt.ts← NEW
      backend-engineer-prompt.ts ← NEW
      index.ts                   ← NEW: barrel export
    types/
      node-config.ts             ← NEW
      artifacts.ts               ← NEW: all artifact interface definitions
      artifact-validators.ts     ← NEW: key-presence validators

  runtime/
    workflows/
      hcr/
        start-hcr-workflow.ts    ← MINOR UPDATE: fire node/execute not chat/requested
        transition-map.ts        ← NEW: HCR_TRANSITION_MAP
      discovery/
        (unchanged)
    artifacts/
      create-artifact.ts         ← UNCHANGED
      get-artifact.ts            ← UNCHANGED

  shared/
    types.ts                     ← ADD: NodeExecuteEvent, NodeCompletedEvent types
    validations/
      (unchanged)

app/
  inngest/
    functions/
      hcr-agent.ts               ← KEEP during migration, then DELETE
      workflow-coordinator.ts    ← NEW
      nodes/
        architect-node.ts        ← NEW
        researcher-node.ts       ← NEW
        prd-reviewer-node.ts     ← NEW
        staff-engineer-node.ts   ← NEW
        frontend-engineer-node.ts← NEW
        backend-engineer-node.ts ← NEW
      embedFile.ts               ← UNCHANGED
    client.ts                    ← UNCHANGED
  api/
    inngest/
      route.ts                   ← UPDATED: register all new functions
    projects/
      [id]/
        chat/
          route.ts               ← UPDATED: fire node/execute instead of chat/requested

lib/
  tool-executor.ts               ← MINOR UPDATE: remove project.status = IDLE from markComplete
  (everything else unchanged)

prisma/
  schema.prisma
```

---

## 16. Implementation Plan — Step by Step

Execute in this exact order to avoid broken builds at each step.

### Step 1: Type Definitions (45 min)

1. Create `src/cognition/types/node-config.ts` (NodeConfig, ContextConfig types)
2. Create `src/cognition/types/artifacts.ts` (all 5 artifact interfaces + existing DiscoveryRequirement)
3. Create `src/cognition/types/artifact-validators.ts` (validators for each type)
4. Create `src/shared/types` additions (NodeExecuteEvent, NodeCompletedEvent)
5. No runtime changes yet.

### Step 2: System Prompts (1 hour)

1. Create `src/cognition/prompts/` directory
2. Write each prompt file (architect, researcher, prd-reviewer, staff-engineer, frontend-engineer, backend-engineer)
3. Create barrel export `src/cognition/prompts/index.ts`
4. Each prompt file exports a single `const [NAME]_SYSTEM_PROMPT: string`

### Step 3: Agent Registry (30 min)

1. Create `src/cognition/agent-registry.ts`
2. Import all prompts
3. Define `AGENT_REGISTRY` as described in section 7

### Step 4: Node Executor (2 hours — the most complex step)

1. Create `src/cognition/node-executor.ts`
2. Implement `executeNode()`:
   - For `outputMode === "structured_json"`: single LLM call + JSON parse + artifact creation
   - For `outputMode === "tool_calls"`: agentic loop (port from `hcr-agent.ts` agent-loop step)
3. Implement JSON retry logic (up to 2 retries on parse failure)
4. Implement artifact key validation
5. Emit runtime events at each stage
6. At completion: fire `inngest.send("node/completed", ...)`

### Step 5: Refactor Context Engine (1 hour)

1. Rename `buildContext` → `buildNodeContext` in `src/cognition/context-engine.ts`
2. Update signature to accept `NodeConfig.contextConfig`
3. Make file tree, vector search, message history, scratchpad conditional on config flags
4. Update any callers (only `executeNode` from step 5 should call it)
5. The old `system-prompt.ts` can be deleted now (prompts are in `prompts/` directory)

### Step 6: Transition Map (20 min)

1. Create `src/runtime/workflows/hcr/transition-map.ts`
2. Define `HCR_TRANSITION_MAP` as described in section 9

### Step 7: Workflow Coordinator (1 hour)

1. Create `app/inngest/functions/workflow-coordinator.ts`
2. Implement coordinator logic (section 10.2)
3. Implement `finalizeWorkflow` helper
4. Handle the parallel FE/BE completion check (count running nodes)


### Step 8: Node Inngest Functions (1 hour)

1. Create `app/inngest/functions/nodes/` directory
2. Create all 6 node files (architect, researcher, prd-reviewer, staff-engineer, frontend-engineer, backend-engineer)
3. Each is ~20 lines using the template from section 11.2

### Step 9: Update startHCRWorkflow (20 min)

1. Update `src/runtime/workflows/hcr/start-hcr-workflow.ts`
2. Change the fired event from `"chat/requested"` to `"node/execute"` with correct payload


### Step 10: Update API Route (15 min)

1. Update `app/api/projects/[id]/chat/route.ts`
2. Fire `"node/execute"` instead of `"chat/requested"`

### Step 11: Register Functions (15 min)

1. Update `app/api/inngest/route.ts`
2. Add all 7 new functions (coordinator + 6 nodes)
3. Keep `hcrAgentFunction` registered (backward compat)


### Step 12: Fix tool-executor.ts (15 min)

1. In `markComplete()`, remove `prisma.project.update({ status: "IDLE" })`
2. Node status and runtime event emission stay (coordinator reads node status)

---

## 17. Edge Cases & Loopholes

### 17.1 Parallel FE/BE completion race condition

Both FE and BE engineers fire `"node/completed"` with `outputArtifactType: null`.
The coordinator must NOT call `finalizeWorkflow` when it sees the first null completion.
**Fix:** Count `node.status IN [CREATED, RUNNING]` for this execution before finalizing. Only finalize if count = 0.

**Risk:** Both coordinator executions run concurrently and both see count = 0 (if they run at the same nanosecond after each node completes).
**Fix:** Use a DB transaction or `prisma.$transaction` in the finalization check. Or use Inngest's idempotency key on the finalization event.

### 17.2 LLM returns non-JSON for structured nodes

Even with strict system prompts, LLMs sometimes prepend "Sure! Here's the JSON:" before the JSON.
**Fix in executeNode:**
1. After receiving content, try to extract JSON with a regex: `content.match(/\{[\s\S]*\}/)`
2. If extracted string parses successfully, use it
3. If not, retry with corrective user message
4. After 3 failures, throw (triggers Inngest retry with fresh LLM call)

### 17.3 Inngest retries a node that already created an artifact

If RESEARCHER creates an artifact then fails on the `node/completed` event, Inngest will retry the whole step.
**Fix:** In `executeNode`, before creating an artifact, check if one already exists for this `nodeId`:
```typescript
const existing = await prisma.artifact.findFirst({ where: { nodeId } });
if (existing) return { artifactId: existing.id, ... };  // idempotent
```

### 17.4 The ARCHITECT node needs to find DISCOVERY_REQUIREMENT by type (not by artifact ID)

The ARCHITECT is the first HCR node. There's no `inputArtifactId` in its event (it's `null`).
**Fix in executeNode:** When `inputArtifactId === null`, look up the consumed artifact by type:
```typescript
const artifact = await prisma.artifact.findFirst({
  where: { projectId, type: nodeConfig.consumedArtifactTypes[0] },
  orderBy: { version: "desc" }
});
```

### 17.5 mark_complete called by FE Engineer during parallel execution

FE Engineer calls `mark_complete` → `executeTool("mark_complete")` → `markComplete()` in tool-executor.
If the old code had `project.status = IDLE` here, it would set the project idle while BE Engineer is still running.
**Fix:** Remove `project.status` update from `markComplete()` (Step 13 of implementation plan).

### 17.6 What if a structured-JSON node produces a valid but empty artifact?

E.g., Researcher returns `{ frameworkRecommendations: [] }` (all empty arrays).
This is technically valid JSON and passes key-presence checks.
**Mitigation:** Add minimum-length validators:
- `researchDossier.frameworkRecommendations.length >= 1`
- `executionPlan.frontendTasks.length >= 1`
- Throw + retry if minimums not met

### 17.7 Inngest function timeout for FE/BE engineer nodes

With `maxIterations: 20` and potentially slow LLM calls, FE/BE nodes could run for 10-15 minutes.
Inngest functions have a default execution timeout.
**Fix:** Check Inngest 4.x docs for `timeout` configuration. Set per-node timeout on the FE/BE functions:
```typescript
{ id: "frontend-engineer-node", retries: 3, timeout: "20m" }
```

### 17.8 Context window overflow for FE/BE nodes on large projects

With many files, the context could exceed the LLM's context window.
**Fix:** The vector search already limits to top-5 relevant files (current behavior).
Add a character limit to the file content slice in `buildNodeContext` (already at 700 chars in current code — keep this).
The ExecutionPlan artifact is injected in full — monitor its size and consider truncating if needed.

### 17.9 Staff Engineer produces tasks with wrong file paths

The FE/BE engineers will try to create/edit paths from `executionPlan.frontendTasks[n].filesToCreate`.
If the Staff Engineer hallucinates invalid paths, the FE/BE nodes will create garbage paths.
**Mitigation in step 5:** Add a path-format validator for the ExecutionPlan artifact:
```typescript
// Validate all file paths match the project's expected pattern (same as PATH_REGEX in validations/file.ts)
```

### 17.10 Backward compat: old projects triggered by "chat/requested"

In-flight projects that used `hcr-agent.ts` (via `"chat/requested"`) will still be running.
The `hcr-agent.ts` function must remain registered until these complete.

---
## 18. Definition of Done

Phase 5A is complete when ALL of the following are true:

**Structural:**
- [ ] 6 cognitive nodes exist as independent Inngest functions
- [ ] Each node has a single, documented responsibility
- [ ] Each node's responsibility is reflected in its system prompt
- [ ] Agent Registry exists and is the sole source of node configuration
- [ ] `AGENT_REGISTRY` is typed — `Record<NodeType, NodeConfig>` with no `any`

**Functional:**
- [ ] Artifact chain: DISCOVERY_REQUIREMENT → ARCHITECTURE_SPEC → RESEARCH_DOSSIER → APPROVED_PRD → EXECUTION_PLAN → (files)
- [ ] Every artifact has a TypeScript interface defining its shape
- [ ] Every structured-JSON node validates its output before persisting
- [ ] Workflow coordinator drives all transitions from the transition map
- [ ] FE and BE nodes run in parallel
- [ ] Project reaches IDLE only after both FE and BE complete

**Observability:**
- [ ] Each node emits `node.created`, `node.running`, `node.completed` (or `node.failed`) runtime events
- [ ] Each artifact creation emits `artifact.created` runtime event
- [ ] Workflow/execution completion events are emitted

**Resilience:**
- [ ] Each node has independent `retries: 3`
- [ ] Failure of one node does NOT corrupt artifacts from previous nodes
- [ ] `executeNode` is idempotent (safe to re-run on Inngest retry)
- [ ] mark_complete no longer sets project status (coordinator owns that)

**Code quality:**
- [ ] No `any` types without `// eslint-disable-next-line` and justification comment
- [ ] `hcr-agent.ts` deleted (after migration window)
- [ ] `system-prompt.ts` deleted (replaced by per-node prompts)
- [ ] All new files follow existing naming conventions
- [ ] TypeScript build passes with zero errors
- [ ] No circular imports

---

## 19. What is Explicitly Out of Scope

The following are NOT part of Phase 5A and should not be attempted:

- Code Reviewer node
- Test Designer node
- QA Runtime
- Repair / retry loops between nodes (e.g., PRD Reviewer rejecting Researcher output)
- Replayability of individual node runs
- Failure intelligence / smart retry with different prompts
- Prompt caching
- Sandboxed execution of generated code
- Remote execution
- Git integration
- CI/CD pipeline
- Deployment automation
- Node-to-node communication (nodes DO NOT talk to each other — only via artifacts)
- Any frontend UI changes to visualize the new node graph (Phase 6 concern)
- Streaming responses from individual nodes
- Multi-project parallelism limits / rate limiting

---

*End of Phase 5A PRD*
