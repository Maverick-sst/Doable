# Doable — Phase 4 PRD
## Artifact-Driven Runtime Architecture, HCR Pipeline & Codebase Restructuring

**Document Version:** 1.0
**Status:** Implementation Ready
**Scope:** Phase 4 complete — from codebase restructuring through HCR pipeline, testing, and frontend handoff
**Prerequisites to read:** Phase 4 Blueprint, Phase 1 Runtime Infrastructure Blueprint, V1 Architecture Blueprint

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Audit — What Exists, What's Broken](#2-current-state-audit)
3. [Phase 4 Goals & Success Criteria](#3-phase-4-goals--success-criteria)
4. [Codebase Restructuring Plan](#4-codebase-restructuring-plan)
5. [Database Schema Analysis](#5-database-schema-analysis)
6. [The Artifact System](#6-the-artifact-system)
7. [Discovery Workflow — Full Implementation](#7-discovery-workflow--full-implementation)
8. [HCR Workflow — Full Implementation](#8-hcr-workflow--full-implementation)
9. [API Route Refactoring](#9-api-route-refactoring)
10. [Inngest Function Refactoring](#10-inngest-function-refactoring)
11. [Known Bugs — Fix Before Anything Else](#11-known-bugs--fix-before-anything-else)
12. [Implementation Order — Step by Step](#12-implementation-order--step-by-step)
13. [Testing Plan](#13-testing-plan)
14. [Frontend Build Handoff Spec](#14-frontend-build-handoff-spec)
15. [What NOT to Build in Phase 4](#15-what-not-to-build-in-phase-4)
16. [Acceptance Criteria](#16-acceptance-criteria)

---

## 1. Executive Summary

### What Phase 4 Is

Phase 4 transforms Doable from a functioning-but-fragile single-agent system into a deterministic, artifact-driven runtime. The core shift:

**Before Phase 4:**
```
User prompt → hidden monolithic agent loop → file mutations → done
```
Context reconstruction happens via ProjectMemory (a mutable JSON blob). Nothing is replayable. Debugging is blind. Cognition is implicit.

**After Phase 4:**
```
User prompt
  → Discovery Workflow → DISCOVERY_REQUIREMENT Artifact (persisted, immutable)
  → HCR Workflow consumes artifact → ARCHITECTURE_SPEC Artifact
  → Execution Node (coding agent) consumes architecture → file mutations
  → All transitions tracked as RuntimeEvents
```

Every cognitive transformation produces a durable artifact. Every state change emits an observable event. The database becomes a ledger, not a scratch pad.

### Why Phase 4 Before Frontend

The frontend will need to:
- Show real-time workflow status to users
- Display what the agent is currently doing
- Show which artifacts have been produced
- Let users see/intervene in discovery

None of that is possible without a stable, observable runtime. Building the frontend on the current architecture means rebuilding it again after Phase 4. Do Phase 4 first.

### What Makes Phase 4 Hard

The codebase currently has:
- A half-migrated `chat/route.ts` (broken TypeScript)
- `workflow-coordinator.ts` using an enum value that doesn't exist in the schema (`MVP_GENERATION`)
- `context-engine.ts` querying ProjectMemory by the wrong field (`id` instead of `projectId`)
- A discovery route that returns a plain object instead of a NextResponse
- A discovery agent with a TypeScript bug in message role mapping
- Two chat routes that overlap (`/api/chat` and `/api/projects/[id]/chat`)

These bugs must be fixed before restructuring begins. Restructuring broken code produces broken structure.

---

## 2. Current State Audit

### 2.1 File Inventory

| File | Purpose | Status |
|------|---------|--------|
| `app/api/chat/route.ts` | Old chat route | ❌ BROKEN — half-migrated, TypeScript errors |
| `app/api/projects/[id]/chat/route.ts` | New chat route | ⚠️ Works but needs cleanup |
| `app/api/projects/[id]/discovery/route.ts` | Discovery endpoint | ❌ BROKEN — returns plain object, not NextResponse |
| `app/api/projects/route.ts` | Project CRUD | ⚠️ Works but validation schema mismatch |
| `lib/workflow-coordinator.ts` | Creates workflow/execution/node | ❌ BROKEN — uses `WorkflowType.MVP_GENERATION` (doesn't exist in schema) |
| `lib/context-engine.ts` | Builds LLM context | ❌ BROKEN — queries `where: { id: projectId }` should be `where: { projectId }` |
| `lib/discovery-agent.ts` | Calls LLM for discovery | ❌ BROKEN — TypeScript error in role mapping |
| `app/inngest/functions/agent.ts` | Main agent Inngest function | ⚠️ Works but tightly coupled to obsolete patterns |
| `lib/tool-executor.ts` | Executes agent tools | ✅ Mostly correct, minor issues |
| `lib/handleFailure.ts` | Marks workflow/exec/node as failed | ✅ Correct |
| `lib/toolCompletion.ts` | Emits tool.completed events | ✅ Correct |
| `lib/validations/prompt.ts` | Validates chat payload | ⚠️ Schema mismatch with new project creation flow |
| `prisma/schema.prisma` | DB schema | ✅ Correct and complete for Phase 4 |

### 2.2 Bug Catalogue

**BUG-001: `WorkflowType.MVP_GENERATION` does not exist**
- File: `lib/workflow-coordinator.ts`, line 12
- Schema defines: `DISCOVERY` | `HCR`
- Current code uses: `WorkflowType.MVP_GENERATION`
- Fix: Change to `WorkflowType.HCR`

**BUG-002: `context-engine.ts` ProjectMemory query uses wrong field**
- File: `lib/context-engine.ts`, line 17
- Current: `prisma.projectMemory.findFirst({ where: { id: projectId } })`
- Fix: `prisma.projectMemory.findFirst({ where: { projectId: projectId } })`
- Impact: Every LLM call gets `null` for project context — the agent is flying blind

**BUG-003: `discovery/route.ts` returns plain object instead of NextResponse**
- File: `app/api/projects/[id]/discovery/route.ts`, last line
- Current: `return {message: response.message.content, discoveryComplete}`
- Fix: `return NextResponse.json({ message: ..., discoveryComplete }, { status: 200 })`
- Impact: Next.js throws a runtime error, discovery endpoint is completely broken

**BUG-004: `discovery-agent.ts` TypeScript role mapping error**
- File: `lib/discovery-agent.ts`, line ~24
- Current: `role: m.role.toLowerCase() as "user" || "assistant"`
- Problem: `"user" || "assistant"` always evaluates to `"user"` — TypeScript union type error
- Fix: `role: (m.role.toLowerCase() === "user" ? "user" : "assistant") as "user" | "assistant"`

**BUG-005: `app/api/chat/route.ts` is broken/half-migrated**
- Contains `if(!body.projectId)` where `body` is typed as `unknown`
- Contains `await` with no right-hand expression (syntax error)
- Fix: Delete this file entirely — `/api/projects/[id]/chat/route.ts` is the correct route

**BUG-006: `ProjectMemory.domain` type mismatch in discovery route**
- Discovery route stores `domain` as a string from request body
- Schema requires `ProjectDomain` enum (`FULL_STACK_APPLICATION` | `LANDING_PAGE`)
- Fix: Validate `domain` against `ProjectDomainSchema` before storing

**BUG-007: `discovery-agent.ts` response structure assumption is wrong**
- Route does: `const { discoveryComplete, requirements, techStack } = response.message.content`
- But `callDiscoveryAgent` returns `JSON.parse(response.choices[0].message.content)` — a plain object
- The route should do: `const { discoveryComplete, requirements, techStack } = response`
- Fix: Correct destructuring in `discovery/route.ts`

**BUG-008: `Project.status` default is `PENDING` in schema but route sets `DISCOVERY`**
- Schema: `status ProjectStatus @default(PENDING)`
- `app/api/projects/route.ts`: `status: "DISCOVERY"` in create call
- These conflict. The schema default is irrelevant since you're overriding it, but the schema default should also be `DISCOVERY`
- Fix: Change schema default to `DISCOVERY` or rely on explicit create (current approach is fine, schema default is misleading)

**BUG-009: `WorkflowType` enum naming inconsistency**
- Schema defines: `DISCOVERY` | `HCR`
- But the Discovery Workflow also uses `WorkflowType.DISCOVERY` — this is correct conceptually but makes the HCR workflow confusingly named
- Per Phase 4 blueprint: Keep `DISCOVERY` and `HCR` — these map to the two workflow runtimes

**BUG-010: Artifact model has `parentArtifactId` but versioning strategy should be simple increment**
- Schema has `parentArtifact` / `childArtifacts` relation — this enables DAG lineage
- Phase 4 says: DON'T build DAG traversal yet
- Fix: Keep the schema field (it doesn't hurt), but DON'T populate `parentArtifactId` in `createArtifact()` — use only `version` increment

### 2.3 Architectural Debt

**Problem 1: ProjectMemory as runtime truth**
- Currently `ProjectMemory.requirements` and `techStack` are the "memory" the agent uses
- These are mutable JSON blobs — no versioning, no history, no replayability
- Phase 4 replaces this with `Artifact` records (immutable, versioned, typed)
- `ProjectMemory` should survive but become a lightweight summary + artifact pointer

**Problem 2: Monolithic `agent.ts` Inngest function**
- Does: context building, LLM calls, tool execution, state tracking, scratchpad management
- Has no separation between orchestration and cognition
- Phase 4: split into Discovery Inngest function + HCR Inngest function
- Keep the existing agent loop as the HCR execution node (don't rewrite it, wrap it)

**Problem 3: Routes doing too much**
- `discovery/route.ts` does: auth, message persistence, LLM call, memory update, project status update
- Routes should only: validate input → call a runtime function → return response
- Phase 4: routes become thin transport layers

**Problem 4: No separation between runtime layer and cognition layer**
- Prompts, LLM calls, orchestration, DB writes all mixed in the same files
- Phase 4: introduce `src/runtime/` and `src/cognition/` directories with clear boundaries

---

## 3. Phase 4 Goals & Success Criteria

### Primary Goals

1. **Artifact-driven cognition** — Discovery and HCR workflows produce typed, immutable, versioned artifacts
2. **Observable runtime** — Every state transition emits a RuntimeEvent; the full execution history is queryable
3. **Clean layer separation** — Runtime never calls LLM; Cognition never writes to DB directly
4. **Deterministic workflows** — Same input always produces the same artifact structure
5. **Bug-free baseline** — All BUG-001 through BUG-010 fixed before restructuring begins

### Non-Goals for Phase 4

- Multi-agent parallelism (no parallel FE/BE nodes yet)
- Deployment pipeline
- Testing runtime (QA node, repair loop)
- Frontend UI
- Advanced context engine improvements
- Artifact DAG traversal
- Sub-agent spawning

### Success Criteria (Measurable)

- [ ] Discovery endpoint creates a `DISCOVERY_REQUIREMENT` artifact in DB
- [ ] HCR workflow reads that artifact — NOT ProjectMemory — to get requirements
- [ ] A full cycle (discovery → HCR → file creation) completes without TypeScript errors
- [ ] All 10 bugs listed above are fixed
- [ ] Every workflow state transition has a corresponding `RuntimeEvent` row
- [ ] `lib/context-engine.ts` correctly builds context from artifact content, not raw ProjectMemory
- [ ] `src/runtime/` and `src/cognition/` directories exist with correct files
- [ ] Old `/api/chat/route.ts` is deleted
- [ ] `workflow-coordinator.ts` uses correct `WorkflowType.HCR`
- [ ] `createArtifact()` is the ONLY way artifacts are created (enforced by having no other path to the Artifact table)

---

## 4. Codebase Restructuring Plan

### 4.1 Target Directory Structure

```
doable/
├── app/                          # Next.js App Router (transport layer only)
│   ├── api/
│   │   ├── projects/
│   │   │   ├── route.ts          # GET (list), POST (create project)
│   │   │   └── [id]/
│   │   │       ├── route.ts      # GET, DELETE project
│   │   │       ├── chat/
│   │   │       │   └── route.ts  # POST → starts HCR workflow
│   │   │       ├── discovery/
│   │   │       │   └── route.ts  # POST → thin wrapper around startDiscoveryWorkflow()
│   │   │       └── files/
│   │   │           ├── route.ts
│   │   │           └── [fileId]/
│   │   │               └── route.ts
│   │   ├── inngest/
│   │   │   └── route.ts          # Inngest serve handler
│   │   └── webhooks/
│   │       └── clerk/
│   │           └── route.ts
│   ├── inngest/
│   │   ├── client.ts
│   │   └── functions/
│   │       ├── discovery.ts      # NEW: Inngest function for discovery workflow
│   │       ├── hcr-agent.ts      # RENAMED from agent.ts
│   │       └── embedFile.ts      # UNCHANGED
│   ├── layout.tsx
│   ├── page.tsx
│   └── ...pages
│
├── src/                          # Core application logic
│   ├── runtime/                  # Orchestration — NO LLM calls here
│   │   ├── workflows/
│   │   │   ├── discovery/
│   │   │   │   ├── start-discovery-workflow.ts
│   │   │   │   └── complete-discovery-workflow.ts
│   │   │   └── hcr/
│   │   │       ├── start-hcr-workflow.ts
│   │   │       └── complete-hcr-workflow.ts
│   │   ├── artifacts/
│   │   │   └── create-artifact.ts   # THE ONLY WAY to create artifacts
│   │   ├── events/
│   │   │   └── emit-event.ts        # Centralized event emission
│   │   └── coordinator/
│   │       └── workflow-coordinator.ts  # Moved from lib/
│   │
│   ├── cognition/               # LLM intelligence — NO DB writes here
│   │   ├── discovery-agent.ts   # Moved/fixed from lib/
│   │   ├── context-engine.ts    # Moved/fixed from lib/
│   │   ├── llm.ts               # Moved from lib/
│   │   └── system-prompt.ts     # Moved from lib/
│   │
│   └── shared/                  # Shared contracts and types
│       ├── types.ts             # LLmMessage and other shared types
│       └── validations/         # Moved from lib/validations/
│           ├── file.ts
│           ├── project.ts
│           ├── project-domain.ts
│           └── prompt.ts
│
├── lib/                         # Infrastructure — stays mostly as-is
│   ├── prisma.ts                # DB client
│   ├── auth-user.ts             # Auth helper
│   ├── embeddings.ts            # Embedding API calls
│   ├── tool-executor.ts         # Tool execution
│   ├── tools.ts                 # Tool definitions
│   ├── handleFailure.ts         # Failure handler
│   └── toolCompletion.ts        # Tool completion handler
│
└── prisma/
    └── schema.prisma
```

### 4.2 Restructuring Rules

**Rule 1: Runtime never calls LLM**
- `src/runtime/` files import from `src/cognition/` — never call `fetch()` to OpenRouter directly
- `src/runtime/` files CAN import from `lib/prisma.ts`

**Rule 2: Cognition never writes to DB directly**
- `src/cognition/` files return structured objects — they do not call `prisma.*`
- Exception: `lib/tool-executor.ts` is an execution tool, not cognition — it CAN write to DB

**Rule 3: Routes are thin**
- Routes do: parse request → validate → call one runtime function → return response
- Routes do NOT: contain business logic, call LLM, query DB directly

**Rule 4: `createArtifact()` is the single artifact creation path**
- No file should call `prisma.artifact.create()` directly
- All artifact creation goes through `src/runtime/artifacts/create-artifact.ts`

**Rule 5: Imports use path aliases**
- `@/src/runtime/...` for runtime layer
- `@/src/cognition/...` for cognition layer
- `@/lib/...` for infrastructure
- Update `tsconfig.json` if needed

### 4.3 Migration Strategy

**Do NOT do a big-bang rewrite.** Migrate incrementally:

1. Fix all bugs first (BUG-001 to BUG-010) — no structural changes
2. Create the `src/runtime/` and `src/cognition/` directories as empty shells
3. Move files one at a time, update imports, verify TypeScript compiles
4. After each file move: run `tsc --noEmit` to catch broken imports
5. Once all files are in their new locations, add the layer boundary rules (linting, code review)

---

## 5. Database Schema Analysis

### 5.1 What's Correct and Should Not Change

The current schema (`schema.prisma`) is well-designed for Phase 4. Do not change:
- `Workflow`, `Execution`, `Node`, `RuntimeEvent` models — these are correct
- `Artifact` model — correct structure
- All enum definitions — correct
- `ProjectMemory` model — keep it, just reduce its scope
- `Message` model with `MessagePhase` — needed for separating discovery chat from build chat

### 5.2 Minor Schema Corrections Needed

**Change 1: Project default status**
```prisma
// Current:
status ProjectStatus @default(PENDING)

// Fix:
status ProjectStatus @default(DISCOVERY)
```
Reason: New projects always start in DISCOVERY phase. The `create` call in `projects/route.ts` already sets this explicitly, but the default should match.

**Change 2: Artifact `parentArtifactId` — leave it, don't use it**
- The field exists and the relation is defined — keep it in schema
- Phase 4: populate only `version` (integer), never set `parentArtifactId`
- The field becomes useful in Phase 5+ when artifact lineage matters

**Change 3: `ProjectMemory.summary` type**
```prisma
// Current:
summary String

// Consider:
summary String @db.Text
```
Reason: Summaries can be long. `@db.Text` prevents truncation issues.

### 5.3 Schema Relationships That Matter for Phase 4

```
User
  └── Project (many)
        ├── ProjectMemory (one) — lightweight summary + domain info
        ├── Message[] — scoped by MessagePhase (DISCOVERY | BUILD)
        ├── File[] — generated code files
        └── Workflow[] (many)
              └── Execution[] (many)
                    ├── Node[] (many)
                    │     └── RuntimeEvent[] (child events)
                    └── RuntimeEvent[] (execution-level events)

Artifact
  ├── projectId → Project
  ├── workflowId → Workflow (NO FK in schema — intentional, raw string ref)
  ├── executionId? → optional
  └── nodeId? → optional
```

**Important:** `Artifact stores both foreign keys and Prisma relations to Workflow, Execution, and Node.
Phase 4 does not yet utilize graph traversal or lineage traversal logic despite relations existing in schema.

### 5.4 MessagePhase Usage

`MessagePhase` enum (`DISCOVERY` | `BUILD`) is critical for separation:
- Discovery chat messages: `phase: MessagePhase.DISCOVERY`
- Build/HCR messages: `phase: MessagePhase.BUILD`
- Always filter by phase when fetching conversation history
- Discovery agent only sees `DISCOVERY` phase messages
- HCR agent only sees `BUILD` phase messages (prevents context pollution)

Currently, neither the discovery route nor the agent function sets `phase`. This must be fixed.

---

## 6. The Artifact System

### 6.1 Core Principle

An artifact is a **durable, immutable record of a completed cognitive transformation**.

Not:
- A log entry
- A state update
- A memory field
- A chat message

It is: "The Discovery node ran, consumed these inputs, and produced this structured output. This output is now the truth for downstream workflows."

### 6.2 `createArtifact()` — The Only Entry Point

File: `src/runtime/artifacts/create-artifact.ts`

```typescript
import { prisma } from "@/lib/prisma";
import { ArtifactType, NodeType } from "@prisma/client";

interface CreateArtifactInput {
  projectId: string;
  workflowId: string;
  executionId?: string;
  nodeId?: string;
  type: ArtifactType;
  producedBy: NodeType;
  content: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export async function createArtifact(input: CreateArtifactInput) {
  // 1. Find the latest version of this artifact type for this project+workflow
  const latest = await prisma.artifact.findFirst({
    where: {
      projectId: input.projectId,
      workflowId: input.workflowId,
      type: input.type,
    },
    orderBy: { version: "desc" },
  });

  const nextVersion = latest ? latest.version + 1 : 1;

  // 2. Create the artifact (NEVER update — always create new version)
  const artifact = await prisma.artifact.create({
    data: {
      projectId: input.projectId,
      workflowId: input.workflowId,
      executionId: input.executionId,
      nodeId: input.nodeId,
      type: input.type,
      version: nextVersion,
      producedBy: input.producedBy,
      content: input.content,
      metadata: input.metadata ?? null,
      // parentArtifactId: DO NOT SET IN PHASE 4
    },
  });

  // 3. Emit a runtime event for observability
  if (input.executionId) {
    await prisma.runtimeEvent.create({
      data: {
        executionId: input.executionId,
        nodeId: input.nodeId ?? null,
        type: "artifact.created",
        payload: {
          artifactId: artifact.id,
          artifactType: artifact.type,
          version: artifact.version,
          workflowId: artifact.workflowId,
        },
      },
    });
  }

  return artifact;
}
```

**Key design decisions:**
- Version is computed by querying latest — no race conditions for single-tenant workloads (acceptable for Phase 4)
- `parentArtifactId` is never set — Phase 4 only needs `version` for "latest artifact" queries
- Event emission is bundled — every artifact creation is automatically observable

### 6.3 Artifact Retrieval Pattern

To get the latest artifact of a type for a project:

```typescript
export async function getLatestArtifact(
  projectId: string,
  type: ArtifactType
) {
  return prisma.artifact.findFirst({
    where: { projectId, type },
    orderBy: { version: "desc" },
  });
}
```

This function should also live in `src/runtime/artifacts/` — perhaps `get-artifact.ts`.

### 6.4 DISCOVERY_REQUIREMENT Artifact Content Shape

This is the primary artifact of Phase 4. Its `content` field must follow this exact JSON shape:

```typescript
interface DiscoveryRequirementsContent {
  projectIntent: {
    summary: string;           // "Build a SaaS task management tool"
    domain: string;            // "FULL_STACK_APPLICATION"
    projectType: string;       // "SaaS" | "Landing Page" | "Dashboard" etc.
  };
  coreFeatures: string[];      // ["User auth", "Task CRUD", "Team workspace"]
  userFlows: string[];         // ["User signs up → creates workspace → invites team"]
  constraints: {
    technical: string[];       // ["Must use PostgreSQL", "React frontend"]
    product: string[];         // ["MVP scope only", "No payment integration"]
    business: string[];        // ["Launch in 2 weeks"]
  };
  integrations: string[];      // ["Clerk for auth", "Stripe for billing"]
  dataEntities: string[];      // ["User", "Project", "Task", "Comment"]
  authRequirements: string[];  // ["Email/password", "OAuth Google"]
  techStack: {
    frontend?: string;
    backend?: string;
    database?: string;
    auth?: string;
    [key: string]: string | undefined;
  };
  assumptions: string[];
  knownAmbiguities: string[];
  confidenceScore: number;     // 0-1, how complete the discovery was
}
```

**Why typed content matters:** The HCR context engine reads `artifact.content` to build the LLM prompt. If the shape is inconsistent, the agent gets garbage context. Type it strictly, validate on write.

### 6.5 Artifact Immutability Enforcement

There is NO `updateArtifact()` function. Ever.

If discovery produces better requirements after a second conversation, call `createArtifact()` again — it creates version 2. The HCR workflow always reads `version: desc` (latest).

This means:
- Full history of how requirements evolved
- Easy rollback (point HCR at version 1 instead of latest)
- No stale-read bugs

---

## 7. Discovery Workflow — Full Implementation

### 7.1 What Discovery Does

Discovery is a **conversational requirement extraction** phase. The user chats with a specialized agent. When the agent determines it has enough information, it produces a structured `DISCOVERY_REQUIREMENT` artifact and flips the project status to `PENDING`.

It is NOT the coding agent. It does NOT create files.

### 7.2 Discovery Workflow Full Flow

```
POST /api/projects/:id/discovery
  │
  ├─ Auth: requireDbUser()
  ├─ Validate: projectId exists, belongs to user, status is DISCOVERY
  ├─ Validate: body has { domain, prompt }
  ├─ Validate: domain against ProjectDomainSchema
  │
  ├─ Save user message to DB: { phase: DISCOVERY, role: USER, content: prompt }
  │
  ├─ startDiscoveryWorkflow(projectId, domain, prompt)
  │     ├─ Create Workflow: { projectId, type: DISCOVERY, status: RUNNING }
  │     ├─ Create Execution: { workflowId, status: RUNNING }
  │     ├─ Create Node: { executionId, type: DISCOVERY, status: RUNNING, order: 1 }
  │     ├─ Emit: workflow.created, execution.created, node.created, node.running
  │     └─ Return: { workflowId, executionId, nodeId }
  │
  ├─ Fetch discovery conversation history from DB
  │     └─ Messages where projectId AND phase = DISCOVERY
  │
  ├─ callDiscoveryAgent(domain, prompt, history)
  │     ├─ Build system prompt with domain context
  │     ├─ Build messages array: [system, ...history, user_prompt]
  │     ├─ Call LLM (no tools)
  │     └─ Parse JSON response: { message, discoveryComplete, requirements?, techStack? }
  │
  ├─ Save assistant message: { phase: DISCOVERY, role: ASSISTANT, content: message }
  │
  ├─ IF discoveryComplete === false:
  │     ├─ Update Node: status = COMPLETED
  │     ├─ Update Execution: status = COMPLETED
  │     ├─ Update Workflow: status = COMPLETED (this was a partial turn)
  │     └─ Return: { message, discoveryComplete: false }
  │
  └─ IF discoveryComplete === true:
        ├─ completeDiscoveryWorkflow(projectId, workflowId, executionId, nodeId, {requirements, techStack, domain})
        │     ├─ createArtifact({ type: DISCOVERY_REQUIREMENT, content: { requirements, techStack, ...mapped } })
        │     ├─ Update ProjectMemory: { summary: "", latestDiscoveryArtifactId: artifact.id }
        │     ├─ Update Project: { status: PENDING }
        │     ├─ Update Node: status = COMPLETED
        │     ├─ Update Execution: status = COMPLETED
        │     ├─ Update Workflow: status = COMPLETED
        │     ├─ Emit: artifact.created, node.completed, execution.completed, workflow.completed
        │     └─ Return: artifact
        └─ Return: { message, discoveryComplete: true, artifactId: artifact.id }
```

### 7.3 Implementation: `start-discovery-workflow.ts`

File: `src/runtime/workflows/discovery/start-discovery-workflow.ts`

```typescript
import { prisma } from "@/lib/prisma";
import { WorkflowType, WorkflowStatus, ExecutionStatus, NodeStatus, NodeType } from "@prisma/client";

export async function startDiscoveryWorkflow(projectId: string) {
  const workflow = await prisma.workflow.create({
    data: {
      projectId,
      type: WorkflowType.DISCOVERY,
      status: WorkflowStatus.RUNNING, // Discovery is synchronous — start it running immediately
    },
  });

  const execution = await prisma.execution.create({
    data: {
      workflowId: workflow.id,
      status: ExecutionStatus.RUNNING,
    },
  });

  const node = await prisma.node.create({
    data: {
      executionId: execution.id,
      type: NodeType.DISCOVERY,
      status: NodeStatus.RUNNING,
      order: 1,
    },
  });

  await prisma.runtimeEvent.createMany({
    data: [
      { executionId: execution.id, type: "workflow.created", payload: { workflowId: workflow.id } },
      { executionId: execution.id, type: "workflow.running", payload: { workflowId: workflow.id } },
      { executionId: execution.id, type: "execution.created", payload: { executionId: execution.id } },
      { executionId: execution.id, type: "execution.running", payload: { executionId: execution.id } },
      { executionId: execution.id, nodeId: node.id, type: "node.created", payload: { nodeId: node.id } },
      { executionId: execution.id, nodeId: node.id, type: "node.running", payload: { nodeId: node.id } },
    ],
  });

  return { workflowId: workflow.id, executionId: execution.id, nodeId: node.id };
}
```

### 7.4 Implementation: `complete-discovery-workflow.ts`

File: `src/runtime/workflows/discovery/complete-discovery-workflow.ts`

```typescript
import { prisma } from "@/lib/prisma";
import { WorkflowStatus, ExecutionStatus, NodeStatus, NodeType, ProjectStatus, ArtifactType } from "@prisma/client";
import { createArtifact } from "@/src/runtime/artifacts/create-artifact";

interface CompleteDiscoveryInput {
  projectId: string;
  workflowId: string;
  executionId: string;
  nodeId: string;
  discoveryResult: {
    domain: string;
    requirements: Record<string, unknown>;
    techStack: Record<string, unknown>;
    rawMessage: string;
  };
}

export async function completeDiscoveryWorkflow(input: CompleteDiscoveryInput) {
  const { projectId, workflowId, executionId, nodeId, discoveryResult } = input;

  // 1. Create the DISCOVERY_REQUIREMENT artifact — this is the durable output
  const artifact = await createArtifact({
    projectId,
    workflowId,
    executionId,
    nodeId,
    type: ArtifactType.DISCOVERY_REQUIREMENT,
    producedBy: NodeType.DISCOVERY,
    content: {
      projectIntent: {
        summary: discoveryResult.rawMessage,
        domain: discoveryResult.domain,
        projectType: discoveryResult.domain === "LANDING_PAGE" ? "Landing Page" : "Full Stack App",
      },
      coreFeatures: discoveryResult.requirements.features ?? [],
      userFlows: discoveryResult.requirements.userFlows ?? [],
      constraints: {
        technical: discoveryResult.requirements.technicalConstraints ?? [],
        product: discoveryResult.requirements.productConstraints ?? [],
        business: [],
      },
      techStack: discoveryResult.techStack,
      dataEntities: discoveryResult.requirements.dataEntities ?? [],
      authRequirements: discoveryResult.requirements.authRequirements ?? [],
      integrations: discoveryResult.requirements.integrations ?? [],
      assumptions: discoveryResult.requirements.assumptions ?? [],
      knownAmbiguities: discoveryResult.requirements.ambiguities ?? [],
      confidenceScore: 0.8, // Can be tuned later
    },
  });

  // 2. Update ProjectMemory to point to this artifact
  await prisma.projectMemory.update({
    where: { projectId },
    data: {
      requirements: discoveryResult.requirements,
      techStack: discoveryResult.techStack,
      summary: discoveryResult.rawMessage,
    },
  });

  // 3. Flip project status to PENDING (ready for HCR)
  await prisma.project.update({
    where: { id: projectId },
    data: { status: ProjectStatus.PENDING },
  });

  // 4. Close out workflow/execution/node
  await prisma.node.update({ where: { id: nodeId }, data: { status: NodeStatus.COMPLETED } });
  await prisma.execution.update({ where: { id: executionId }, data: { status: ExecutionStatus.COMPLETED } });
  await prisma.workflow.update({ where: { id: workflowId }, data: { status: WorkflowStatus.COMPLETED } });

  // 5. Emit completion events
  await prisma.runtimeEvent.createMany({
    data: [
      { executionId, nodeId, type: "node.completed", payload: { nodeId, artifactId: artifact.id } },
      { executionId, type: "execution.completed", payload: { executionId } },
      { executionId, type: "workflow.completed", payload: { workflowId } },
    ],
  });

  return artifact;
}
```

### 7.5 Refactored Discovery Route

File: `app/api/projects/[id]/discovery/route.ts`

This becomes thin — just transport:

```typescript
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { startDiscoveryWorkflow } from "@/src/runtime/workflows/discovery/start-discovery-workflow";
import { completeDiscoveryWorkflow } from "@/src/runtime/workflows/discovery/complete-discovery-workflow";
import { callDiscoveryAgent } from "@/src/cognition/discovery-agent";
import { MessagePhase, ProjectStatus } from "@prisma/client";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const projectId = (await params).id;

  // 1. Guard: project must exist, belong to user, and be in DISCOVERY status
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id, status: ProjectStatus.DISCOVERY },
    include: { memory: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found or not in discovery phase" }, { status: 404 });

  // 2. Parse and validate body
  let body: { domain: string; prompt: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { domain, prompt } = body;
  if (!domain || !prompt) {
    return NextResponse.json({ error: "domain and prompt are required" }, { status: 400 });
  }

  // 3. Save user message (DISCOVERY phase)
  await prisma.message.create({
    data: { projectId, role: "USER", content: prompt, phase: MessagePhase.DISCOVERY },
  });

  // 4. Start discovery workflow (creates workflow/execution/node, emits events)
  const { workflowId, executionId, nodeId } = await startDiscoveryWorkflow(projectId);

  // 5. Fetch conversation history (DISCOVERY phase only)
  const history = await prisma.message.findMany({
    where: { projectId, phase: MessagePhase.DISCOVERY },
    select: { role: true, content: true },
    orderBy: { createdAt: "asc" },
  });

  // 6. Call discovery agent (cognition layer — returns structured object)
  let agentResponse;
  try {
    agentResponse = await callDiscoveryAgent(domain, prompt, history);
  } catch (err) {
    // Handle LLM failure — mark workflow failed
    // TODO: call handleFailure(executionId, nodeId, workflowId)
    return NextResponse.json({ error: "Discovery agent failed" }, { status: 500 });
  }

  const { message, discoveryComplete, requirements, techStack } = agentResponse;

  // 7. Save assistant message (DISCOVERY phase)
  await prisma.message.create({
    data: { projectId, role: "ASSISTANT", content: message, phase: MessagePhase.DISCOVERY },
  });

  // 8. If incomplete: close workflow turn, return question
  if (!discoveryComplete) {
    await prisma.node.update({ where: { id: nodeId }, data: { status: "COMPLETED" } });
    await prisma.execution.update({ where: { id: executionId }, data: { status: "COMPLETED" } });
    await prisma.workflow.update({ where: { id: workflowId }, data: { status: "COMPLETED" } });
    return NextResponse.json({ message, discoveryComplete: false }, { status: 200 });
  }

  // 9. If complete: create artifact, update memory, flip project status
  const artifact = await completeDiscoveryWorkflow({
    projectId, workflowId, executionId, nodeId,
    discoveryResult: { domain, requirements, techStack, rawMessage: message },
  });

  return NextResponse.json({ message, discoveryComplete: true, artifactId: artifact.id }, { status: 200 });
}
```

### 7.6 Discovery Agent — Fixed Implementation

File: `src/cognition/discovery-agent.ts`

Key fixes from the broken version:
- Fixed role mapping TypeScript error
- Correct response structure returned

```typescript
import { callLLM } from "./llm";
import { LLmMessage } from "@/src/shared/types";

interface DiscoveryAgentResponse {
  message: string;
  discoveryComplete: boolean;
  requirements?: Record<string, unknown>;
  techStack?: Record<string, unknown>;
}

export async function callDiscoveryAgent(
  domain: string,
  prompt: string,
  history: { role: string; content: string }[]
): Promise<DiscoveryAgentResponse> {
  const systemPrompt = `
You are a requirement discovery agent for Doable, an AI software engineering platform.
Domain: ${domain}

Your job: Ask maximum 3-5 focused questions to fully understand the user's project.
Ask ONE question at a time. Be friendly, concise, non-technical.
If user says "surprise me" → pick sensible defaults immediately.

When you have enough information, respond with ONLY this exact JSON:
{
  "message": "Great! I have everything I need to start building...",
  "discoveryComplete": true,
  "requirements": {
    "description": "...",
    "features": ["feature1", "feature2"],
    "userFlows": ["flow1"],
    "dataEntities": ["Entity1"],
    "authRequirements": ["email/password"],
    "integrations": [],
    "technicalConstraints": [],
    "productConstraints": [],
    "assumptions": [],
    "ambiguities": []
  },
  "techStack": {
    "frontend": "React + Vite + Tailwind",
    "backend": "Node.js + Express",
    "database": "PostgreSQL",
    "auth": "Clerk"
  }
}

Until you have enough information, respond with ONLY this JSON:
{
  "message": "your question here",
  "discoveryComplete": false
}

NEVER explain yourself. NEVER start building. NEVER use tools. ONLY output JSON.
`;

  const messages: LLmMessage[] = [
    { role: "system", content: systemPrompt },
    // Inject history correctly
    ...history.map((m) => ({
      role: (m.role === "USER" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: prompt },
  ];

  const response = await callLLM(messages, []);
  const rawContent = response.choices[0].message.content;

  try {
    return JSON.parse(rawContent) as DiscoveryAgentResponse;
  } catch {
    // LLM returned non-JSON — treat as a follow-up question
    return { message: rawContent, discoveryComplete: false };
  }
}
```

---

## 8. HCR Workflow — Full Implementation

### 8.1 What HCR Does

HCR (Hierarchical Cognitive Runtime) is the **implementation phase**. It is triggered after discovery completes (project status = `PENDING`). It takes the `DISCOVERY_REQUIREMENT` artifact and uses it to:
1. Understand what needs to be built
2. Execute the coding agent loop (file creation, editing)
3. Mark the project complete

In Phase 4, HCR is a single node (ARCHITECT). In Phase 5+, it will expand to multiple nodes (Research → PRD → Planner → FE/BE).

### 8.2 HCR Workflow Full Flow

```
POST /api/projects/:id/chat
  │
  ├─ Auth: requireDbUser()
  ├─ Validate: project exists, belongs to user, status is PENDING or IDLE
  │
  ├─ Save user message to DB: { phase: BUILD, role: USER, content: prompt }
  │
  ├─ startHCRWorkflow(projectId, userId, prompt)
  │     ├─ Create Workflow: { projectId, type: HCR, status: CREATED }
  │     ├─ Create Execution: { workflowId, status: CREATED }
  │     ├─ Create Node: { executionId, type: ARCHITECT, status: CREATED, order: 1 }
  │     ├─ Emit: workflow.created, execution.created, node.created
  │     └─ Return: { workflowId, executionId, nodeId }
  │
  ├─ inngest.send("chat/requested", { projectId, prompt, messageId, userId, workflowId, executionId, nodeId })
  │
  └─ Return: { projectId, messageId, status: "processing" }

--- async in Inngest ---

Inngest function: "hcr-agent" listens to "chat/requested"
  │
  ├─ step: "fetch_initial_context"
  │     ├─ Fetch project + files + messages (BUILD phase only)
  │     └─ Fetch DISCOVERY_REQUIREMENT artifact (latest version for this project)
  │
  ├─ step: "agent-loop"
  │     ├─ Mark execution + node as RUNNING
  │     ├─ Emit: execution.running, node.running
  │     ├─ Build LLM context FROM ARTIFACT (not from ProjectMemory)
  │     └─ Agentic loop: call LLM → execute tools → repeat
  │
  └─ step: "finalize"
        ├─ Mark project status = IDLE (or COMPLETED if mark_complete called)
        ├─ Mark execution = COMPLETED
        └─ Emit: workflow.completed
```

### 8.3 HCR Context Engine — Artifact-Aware

This is the critical change: the context engine must read the `DISCOVERY_REQUIREMENT` artifact instead of reconstructing from `ProjectMemory`.

File: `src/cognition/context-engine.ts`

```typescript
import { prisma } from "@/lib/prisma";
import { LLmMessage, RelevantFile } from "@/src/shared/types";
import { SYSTEM_PROMPT } from "./system-prompt";
import { ArtifactType } from "@prisma/client";

export async function buildContext(
  projectId: string,
  files: { id: string; path: string; embeddingStatus: string }[],
  messages: { role: string; content: string }[],
  promptEmbedding: number[],
  prompt: string,
  toolHistory: Array<{
    role: "assistant" | "tool";
    content: string | null;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }>,
  currentContext: {
    currentTask: string;
    iteration: number;
    scratchpad: string[];
  },
  // NEW: accept artifact content directly
  discoveryArtifact?: Record<string, unknown> | null
): Promise<LLmMessage[]> {

  // Fetch long-term memory via vector search
  const promptEmbeddingString = `[${promptEmbedding.join(",")}]`;
  const longTermMem = await prisma.$queryRaw<RelevantFile[]>`
    SELECT id, path, content FROM "File"
    WHERE "projectId" = ${projectId}
      AND "embeddingStatus" = 'EMBEDDING_SUCCESSFUL'
    ORDER BY embedding <=> ${promptEmbeddingString}::vector
    LIMIT 5`;

  // Build project context section from artifact (not ProjectMemory)
  const artifactContext = discoveryArtifact
    ? `
=== PROJECT REQUIREMENTS (from Discovery) ===
Domain: ${(discoveryArtifact.projectIntent as Record<string, string>)?.domain ?? "Unknown"}
Summary: ${(discoveryArtifact.projectIntent as Record<string, string>)?.summary ?? ""}
Features: ${((discoveryArtifact.coreFeatures as string[]) ?? []).join(", ")}
Tech Stack: ${JSON.stringify(discoveryArtifact.techStack ?? {})}
Data Entities: ${((discoveryArtifact.dataEntities as string[]) ?? []).join(", ")}
Auth: ${((discoveryArtifact.authRequirements as string[]) ?? []).join(", ")}
`
    : "=== PROJECT REQUIREMENTS ===\nNo discovery artifact found. Build a sensible default React app.";

  const contextMessages: LLmMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `
${artifactContext}

=== CURRENT TASK ===
${currentContext.currentTask || prompt}

=== FILE TREE ===
${files.length > 0 ? files.map((f) => f.path).join("\n") : "No files yet!"}

=== RELEVANT FILES ===
${longTermMem.length > 0
          ? longTermMem.map((f) => `[${f.path}]\n${f.content.slice(0, 700)}${f.content.length > 700 ? "..." : ""}`).join("\n---\n")
          : "No relevant files found yet."
        }

=== RECENT SCRATCHPAD (last 8 steps) ===
${currentContext.scratchpad.slice(-8).join("\n") || "No previous steps yet"}
      `.trim(),
    },
    // Past BUILD conversation history
    ...messages.map((m) => ({
      role: m.role.toLowerCase() as "user" | "assistant",
      content: m.content,
    } as LLmMessage)),
    // Tool history
    ...toolHistory.flatMap((entry): LLmMessage[] => {
      if (entry.role === "assistant" && entry.tool_calls && entry.tool_calls.length > 0) {
        return [{ role: "assistant", content: null, tool_calls: entry.tool_calls as never[] }];
      } else if (entry.role === "tool" && entry.tool_call_id) {
        return [{ role: "tool", content: entry.content || "(no output)", tool_call_id: entry.tool_call_id }];
      }
      return [{ role: "assistant", content: entry.content || "" }];
    }),
    { role: "user", content: prompt },
  ];

  return contextMessages;
}
```

### 8.4 HCR Inngest Function — Refactored

File: `app/inngest/functions/hcr-agent.ts`

Key changes from the old `agent.ts`:
- Fetches `DISCOVERY_REQUIREMENT` artifact in initial context step
- Passes artifact to context engine
- Messages filtered to `BUILD` phase only
- Uses correct `WorkflowType.HCR`

```typescript
import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { getEmbeddings } from "@/lib/embeddings";
import { buildContext } from "@/src/cognition/context-engine";
import { callLLM } from "@/src/cognition/llm";
import { tools } from "@/lib/tools";
import { executeTool } from "@/lib/tool-executor";
import { ExecutionStatus, NodeStatus, NodeType, ArtifactType, MessagePhase } from "@prisma/client";
import { handleFailure } from "@/lib/handleFailure";
import { handleToolCompletion } from "@/lib/toolCompletion";

export const hcrAgentFunction = inngest.createFunction(
  {
    id: "hcr-agent",
    retries: 3,
    onFailure: async ({ event }) => {
      const { workflowId, executionId, nodeId } = event.data.event.data;
      await handleFailure(executionId, nodeId, workflowId);
    },
    triggers: [{ event: "chat/requested" }],
  },
  async ({ event, step }) => {
    // STEP 1: Fetch all context needed before the agent loop
    const contextData = await step.run("fetch_initial_context", async () => {
      const { projectId, userId, prompt } = event.data;

      const project = await prisma.project.findFirst({
        where: { id: projectId, userId },
        include: {
          files: { select: { id: true, path: true, embeddingStatus: true } },
          messages: {
            where: { phase: MessagePhase.BUILD }, // BUILD phase messages only
            orderBy: { createdAt: "desc" },
            take: 10,
            select: { role: true, content: true },
          },
        },
      });

      // Fetch the latest DISCOVERY_REQUIREMENT artifact for this project
      const discoveryArtifact = await prisma.artifact.findFirst({
        where: { projectId, type: ArtifactType.DISCOVERY_REQUIREMENT },
        orderBy: { version: "desc" },
      });

      return {
        projectId: project?.id ?? "",
        files: project?.files ?? [],
        messages: project?.messages?.reverse() ?? [],
        prompt,
        discoveryArtifactContent: discoveryArtifact?.content ?? null,
      };
    });

    // STEP 2: The agentic loop
    await step.run("agent-loop", async () => {
      const { userId, executionId, nodeId } = event.data;
      const { projectId, files, messages, prompt, discoveryArtifactContent } = contextData;

      let iterations = 0;
      const MAX_ITERATIONS = Number(process.env.MAX_ITERATIONS) || 12;

      let currentContext = { currentTask: "", iteration: 0, scratchpad: [] as string[] };
      const toolHistory: Array<{
        role: "assistant" | "tool";
        content: string | null;
        tool_calls?: unknown[];
        tool_call_id?: string;
      }> = [];

      const promptEmbedding = await getEmbeddings(prompt);

      // Mark as running
      const execution = await prisma.execution.update({
        where: { id: executionId },
        data: { status: ExecutionStatus.RUNNING },
      });
      const node = await prisma.node.update({
        where: { id: nodeId },
        data: { status: NodeStatus.RUNNING },
      });
      await prisma.runtimeEvent.createMany({
        data: [
          { executionId, type: "execution.running", payload: { executionId } },
          { executionId, nodeId, type: "node.running", payload: { nodeId, type: NodeType.ARCHITECT } },
        ],
      });

      while (iterations < MAX_ITERATIONS) {
        iterations++;

        // Build context using the discovery artifact
        const request = await buildContext(
          projectId, files, messages, promptEmbedding, prompt, toolHistory, currentContext,
          discoveryArtifactContent as Record<string, unknown> | null
        );

        const response = await callLLM(request, tools);
        const message = response.choices[0].message;

        toolHistory.push({
          role: "assistant",
          content: message.content,
          tool_calls: message.tool_calls || undefined,
        });

        if (!message.tool_calls || message.tool_calls.length === 0) break;

        const tool_call = message.tool_calls[0];

        await prisma.runtimeEvent.create({
          data: {
            executionId, nodeId, type: "tool.called",
            payload: { tool: tool_call.function.name, args: JSON.parse(tool_call.function.arguments), iteration: iterations },
          },
        });

        if (tool_call.function.name === "mark_complete") {
          const args = JSON.parse(tool_call.function.arguments);
          await executeTool("mark_complete", args, projectId, userId, execution.id, node.id);
          await handleToolCompletion(executionId, nodeId, { tool: "mark_complete", result: "completed", iteration: iterations });
          break;
        }

        const args = JSON.parse(tool_call.function.arguments);
        const toolResult = await executeTool(tool_call.function.name, args, projectId, userId, execution.id, node.id);

        toolHistory.push({ role: "tool", content: toolResult, tool_call_id: tool_call.id });

        const shortLog = toolResult.length > 100 ? toolResult.substring(0, 100) + "..." : toolResult;
        await handleToolCompletion(executionId, nodeId, { tool: tool_call.function.name, result: shortLog, iteration: iterations });

        currentContext = {
          currentTask: prompt,
          iteration: iterations,
          scratchpad: [...currentContext.scratchpad, `[${iterations}]: ${tool_call.function.name}() -> ${shortLog}`],
        };
      }
    });

    // STEP 3: Finalize — flip project back to IDLE
    await step.run("finalize", async () => {
      await prisma.project.update({
        where: { id: contextData.projectId },
        data: { status: "IDLE" },
      });
    });
  }
);
```

### 8.5 Fixed `start-hcr-workflow.ts`

File: `src/runtime/workflows/hcr/start-hcr-workflow.ts`

This replaces `lib/workflow-coordinator.ts` and fixes BUG-001:

```typescript
import { prisma } from "@/lib/prisma";
import { WorkflowType, WorkflowStatus, ExecutionStatus, NodeStatus, NodeType } from "@prisma/client";

export async function startHCRWorkflow(projectId: string, userId: string, prompt: string) {
  const workflow = await prisma.workflow.create({
    data: {
      projectId,
      type: WorkflowType.HCR, // Fixed: was MVP_GENERATION
      status: WorkflowStatus.CREATED,
    },
  });

  const execution = await prisma.execution.create({
    data: {
      workflowId: workflow.id,
      status: ExecutionStatus.CREATED,
    },
  });

  const node = await prisma.node.create({
    data: {
      executionId: execution.id,
      type: NodeType.ARCHITECT,
      status: NodeStatus.CREATED,
      order: 1,
    },
  });

  await prisma.runtimeEvent.createMany({
    data: [
      { executionId: execution.id, type: "workflow.created", payload: { workflowId: workflow.id } },
      { executionId: execution.id, type: "execution.created", payload: { executionId: execution.id } },
      { executionId: execution.id, nodeId: node.id, type: "node.created", payload: { nodeId: node.id, type: NodeType.ARCHITECT } },
    ],
  });

  return { workflowId: workflow.id, executionId: execution.id, nodeId: node.id };
}
```

---

## 9. API Route Refactoring

### 9.1 Route Responsibility Matrix

| Route | Responsibility | What It Should NOT Do |
|-------|---------------|----------------------|
| `POST /api/projects` | Create project + ProjectMemory in transaction | LLM calls, file creation |
| `GET /api/projects` | List user's projects | — |
| `GET /api/projects/:id` | Get project with files + messages | Business logic |
| `DELETE /api/projects/:id` | Delete project | — |
| `POST /api/projects/:id/discovery` | Thin wrapper → `startDiscoveryWorkflow` chain | Direct DB writes (delegate to runtime) |
| `POST /api/projects/:id/chat` | Validate → `startHCRWorkflow` → fire Inngest event | LLM calls, tool execution |
| `POST /api/projects/:id/files` | Create file + trigger embedding | — |
| `GET/PATCH/DELETE /api/projects/:id/files/:fileId` | File CRUD | — |

### 9.2 `POST /api/projects` — Project Creation

Current issue: this route imports `CreatePromptSchema` (which has `prompt` + `domain`) but should be creating a project. The project creation should ONLY need `domain`.

```typescript
// app/api/projects/route.ts

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireDbUser } from "@/lib/auth-user";
import { ProjectDomainSchema } from "@/src/shared/validations/project-domain";
import { ProjectStatus } from "@prisma/client";
import { z } from "zod";

const CreateProjectSchema = z.object({
  domain: ProjectDomainSchema.shape.domain,
});

export async function POST(request: Request) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const validation = CreateProjectSchema.safeParse(body);
  if (!validation.success) return NextResponse.json({ error: validation.error.flatten() }, { status: 400 });

  const { domain } = validation.data;

  try {
    let projectId = "";

    await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { name: "", userId: user.id, status: ProjectStatus.DISCOVERY },
      });
      projectId = project.id;

      await tx.projectMemory.create({
        data: {
          projectId: project.id,
          domain,
          requirements: {},
          techStack: {},
          summary: "",
        },
      });
    });

    return NextResponse.json({ projectId, message: "Project created" }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
```

### 9.3 Delete the Old Chat Route

File to delete: `app/api/chat/route.ts`

This file is broken (BUG-005) and duplicated by `app/api/projects/[id]/chat/route.ts`. Delete it.

If any references exist to `/api/chat`, update them to `/api/projects/:id/chat`.

### 9.4 `POST /api/projects/:id/chat` — Cleaned Up

```typescript
// app/api/projects/[id]/chat/route.ts

import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { inngest } from "@/app/inngest/client";
import { startHCRWorkflow } from "@/src/runtime/workflows/hcr/start-hcr-workflow";
import { MessagePhase, ProjectStatus } from "@prisma/client";
import { z } from "zod";

const ChatSchema = z.object({
  prompt: z.string().min(1).max(10000),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const projectId = (await params).id;

  const project = await prisma.project.findUnique({
    where: { id: projectId, userId: user.id, status: { in: [ProjectStatus.PENDING, ProjectStatus.IDLE] } },
  });
  if (!project) return NextResponse.json({ error: "Project not found or not ready for chat" }, { status: 404 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const validation = ChatSchema.safeParse(body);
  if (!validation.success) return NextResponse.json({ error: validation.error.flatten() }, { status: 400 });

  const { prompt } = validation.data;

  const message = await prisma.message.create({
    data: { projectId, role: "USER", content: prompt, phase: MessagePhase.BUILD },
  });

  const { workflowId, executionId, nodeId } = await startHCRWorkflow(projectId, user.id, prompt);

  try {
    await inngest.send({
      name: "chat/requested",
      data: { projectId, prompt: message.content, messageId: message.id, userId: user.id, workflowId, executionId, nodeId },
    });
  } catch {
    return NextResponse.json({ error: "Failed to queue agent execution" }, { status: 500 });
  }

  return NextResponse.json({ projectId, messageId: message.id, status: "processing" });
}
```

---

## 10. Inngest Function Refactoring

### 10.1 Register Both Functions

File: `app/api/inngest/route.ts`

```typescript
import { serve } from "inngest/next";
import { inngest } from "@/app/inngest/client";
import { hcrAgentFunction } from "@/app/inngest/functions/hcr-agent"; // renamed
import { embedFileFunction } from "@/app/inngest/functions/embedFile"; // unchanged

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [hcrAgentFunction, embedFileFunction],
});
```

Note: Discovery workflow is **synchronous** (HTTP request-response), not Inngest. It does not need an Inngest function. Only HCR is async via Inngest.

### 10.2 Why Discovery Is Synchronous

Discovery is a chat-like interaction. The user sends a message, gets a response, sends another. Making it async (via Inngest) would require polling or WebSockets to show the agent's reply. HTTP request-response is simpler and correct for this use case.

HCR is async because it can run for minutes (up to 12 tool calls, each involving file operations and LLM calls). It would timeout an HTTP request.

---

## 11. Known Bugs — Fix Before Anything Else

The following bugs MUST be fixed in this exact order before any restructuring begins. Each fix is small and isolated.

### Fix Order

**Fix 1 — BUG-001: `WorkflowType.MVP_GENERATION`**
```typescript
// lib/workflow-coordinator.ts, line 12
// Before:
type: WorkflowType.MVP_GENERATION,
// After:
type: WorkflowType.HCR,
```

**Fix 2 — BUG-002: `context-engine.ts` wrong query field**
```typescript
// lib/context-engine.ts, line 17
// Before:
prisma.projectMemory.findFirst({ where: { id: projectId } })
// After:
prisma.projectMemory.findFirst({ where: { projectId: projectId } })
```

**Fix 3 — BUG-003: `discovery/route.ts` returns plain object**
```typescript
// app/api/projects/[id]/discovery/route.ts, last line
// Before:
return {message: response.message.content, discoveryComplete};
// After:
return NextResponse.json({ message, discoveryComplete }, { status: 200 });
```

**Fix 4 — BUG-004: Discovery agent role mapping**
```typescript
// lib/discovery-agent.ts
// Before:
role: m.role.toLowerCase() as "user" || "assistant"
// After:
role: (m.role.toLowerCase() === "user" ? "user" : "assistant") as "user" | "assistant"
```

**Fix 5 — BUG-007: Discovery route response destructuring**
```typescript
// app/api/projects/[id]/discovery/route.ts
// Before:
const { discoveryComplete, requirements, techStack } = response.message.content;
// After:
const { message, discoveryComplete, requirements, techStack } = response;
```

**Fix 6 — BUG-005: Delete old chat route**
```bash
rm app/api/chat/route.ts
```

After these 6 fixes, run `tsc --noEmit`. It should compile (or show only expected type issues). Then begin restructuring.

---

## 12. Implementation Order — Step by Step

### Phase 4A: Stabilize the Existing Code

1. Apply all 6 fixes listed in Section 11
2. Run `tsc --noEmit` — resolve all TypeScript errors

### Phase 4B: Create the Runtime Structure

1. Create `src/runtime/` and `src/cognition/` and `src/shared/` directories
2. Create the `createArtifact()` function in `src/runtime/artifacts/create-artifact.ts`
3. Create `getLatestArtifact()` in `src/runtime/artifacts/get-artifact.ts`
4. Verify: `prisma.artifact.create()` is called ONLY through `createArtifact()`
5. DO NOT move any existing files yet

### Phase 4C: Discovery Workflow Runtime

1. Create `src/runtime/workflows/discovery/start-discovery-workflow.ts`
2. Create `src/runtime/workflows/discovery/complete-discovery-workflow.ts`
3. Move and fix `lib/discovery-agent.ts` → `src/cognition/discovery-agent.ts`
4. Rewrite `app/api/projects/[id]/discovery/route.ts` to use the new functions


### Phase 4D: HCR Workflow Runtime

1. Create `src/runtime/workflows/hcr/start-hcr-workflow.ts` (replaces `lib/workflow-coordinator.ts`)
2. Move and fix `lib/context-engine.ts` → `src/cognition/context-engine.ts` (artifact-aware)
3. Rename `app/inngest/functions/agent.ts` → `app/inngest/functions/hcr-agent.ts`
4. Update `hcr-agent.ts` to: fetch discovery artifact, filter messages by BUILD phase, pass artifact to context engine
5. Update `app/api/projects/[id]/chat/route.ts` to use `startHCRWorkflow`
6. Update `app/api/inngest/route.ts` to register `hcrAgentFunction`

### Phase 4E: File Migration

Move remaining `lib/` files to their new `src/` homes:

1. `lib/llm.ts` → `src/cognition/llm.ts`
2. `lib/system-prompt.ts` → `src/cognition/system-prompt.ts`
3. `lib/types.ts` → `src/shared/types.ts`
4. `lib/validations/*` → `src/shared/validations/*`
5. `lib/workflow-coordinator.ts` → DELETE (replaced by `start-hcr-workflow.ts`)

After each move: run `tsc --noEmit` to catch broken imports.


---

## 13. Testing Plan

### 13.1 TypeScript Strictness Check

After all migrations:
```bash
tsc --noEmit --strict
```

All errors must be resolved. No `any` types without a comment explaining why.


## 14. Frontend Build Handoff Spec

This section defines what the backend will expose for the frontend to consume. Build this BEFORE starting frontend work.

### 14.1 API Endpoints the Frontend Needs

```
POST /api/projects
  Body: { domain: "FULL_STACK_APPLICATION" | "LANDING_PAGE" }
  Response: { projectId: string }
  Usage: Create new project, get projectId for subsequent calls

GET /api/projects
  Response: { projects: [{ id, name, status, createdAt }] }
  Usage: Dashboard list

GET /api/projects/:id
  Response: { project: { id, name, status, files: [...], messages: [...] } }
  Usage: Project detail page

POST /api/projects/:id/discovery
  Body: { domain: string, prompt: string }
  Response: { message: string, discoveryComplete: boolean, artifactId?: string }
  Usage: Discovery chat interface — send message, show response

POST /api/projects/:id/chat
  Body: { prompt: string }
  Response: { messageId: string, status: "processing" }
  Usage: Start HCR execution — show loading state

GET /api/projects/:id/status (NEW — needs to be built)
  Response: { status: ProjectStatus, latestWorkflow: { id, type, status }, latestExecution: { id, status, nodeCount } }
  Usage: Polling endpoint for frontend to check if agent is done

GET /api/projects/:id/files
  Response: { files: [{ id, path, content }] }
  Usage: File explorer / code viewer
```

### 14.2 `GET /api/projects/:id/status` — New Endpoint Needed

This endpoint does NOT exist yet. The frontend needs it to poll for agent completion. Build it in Phase 4 so it's ready for frontend.

```typescript
// app/api/projects/[id]/status/route.ts
// Returns: latest workflow + execution + events for a project
// Used by frontend to show "agent is working..." vs "done"
```

### 14.3 Real-Time Updates (Phase 5 or later)

Phase 4 uses polling. The frontend polls `/status` every 2 seconds while `project.status === IN_PROGRESS`. This is intentionally simple.

WebSockets or Server-Sent Events (SSE) can replace polling in Phase 5.

### 14.4 Frontend State Machine

The frontend should drive this state machine based on API responses:

```
CREATE_PROJECT (POST /api/projects)
    ↓
DISCOVERY_CHAT (POST /api/projects/:id/discovery, loop until discoveryComplete=true)
    ↓
BUILD_STARTED (POST /api/projects/:id/chat)
    ↓
BUILD_POLLING (GET /api/projects/:id/status, poll until status=IDLE)
    ↓
BUILD_COMPLETE (show generated files)
```

---

## 15. What NOT to Build in Phase 4

This list prevents scope creep. If you find yourself building any of these, stop.

- **Multi-node HCR** (Research → PRD → Planner → FE/BE split) — Phase 5
- **Parallel worker spawning** — Phase 5
- **Code execution / sandbox** — Phase 6
- **Deployment pipeline** — Phase 7
- **Repair/QA loop** — Phase 5
- **Frontend UI** — starts after Phase 4F is verified
- **Artifact DAG traversal** — not needed until Phase 5
- **`parentArtifactId` population** — leave null in Phase 4
- **Artifact content Zod validation** — nice to have, not blocking
- **`GET /api/projects/:id/events`** — not needed for Phase 4, good for Phase 5 observability dashboard
- **WebSocket / SSE** — polling is sufficient for Phase 4 frontend

---

## 16. Acceptance Criteria

Phase 4 is complete when ALL of the following are true:

### Bug Fixes
- [ ] `WorkflowType.MVP_GENERATION` reference is gone from codebase
- [ ] `context-engine.ts` queries ProjectMemory by `projectId` (not `id`)
- [ ] `discovery/route.ts` returns `NextResponse.json()`
- [ ] Discovery agent role mapping uses correct TypeScript
- [ ] `app/api/chat/route.ts` is deleted
- [ ] Discovery route destructures agent response correctly

### Artifact System
- [ ] `createArtifact()` exists in `src/runtime/artifacts/`
- [ ] No file calls `prisma.artifact.create()` directly (search codebase)
- [ ] After a complete discovery session: one `Artifact` row exists with `type=DISCOVERY_REQUIREMENT`
- [ ] Artifact `version` increments correctly on second discovery (version=2)
- [ ] Artifact `content` follows the defined shape (has `projectIntent`, `coreFeatures`, `techStack`)
- [ ] Every artifact creation emits an `artifact.created` RuntimeEvent

### Discovery Workflow
- [ ] Discovery endpoint creates Workflow/Execution/Node rows on every call
- [ ] Messages are saved with `phase=DISCOVERY`
- [ ] Incomplete discovery returns a question, not an artifact
- [ ] Complete discovery flips `Project.status` to `PENDING`
- [ ] Complete discovery creates a `DISCOVERY_REQUIREMENT` artifact

### HCR Workflow
- [ ] HCR workflow uses `WorkflowType.HCR`
- [ ] HCR context engine reads from `DISCOVERY_REQUIREMENT` artifact (not ProjectMemory.requirements)
- [ ] HCR fetches only `BUILD` phase messages for conversation history
- [ ] After HCR completes: `Project.status = IDLE`
- [ ] After HCR completes: RuntimeEvents include node.completed, execution.completed, workflow.completed

### Codebase Structure
- [ ] `src/runtime/` directory exists with correct subdirectories
- [ ] `src/cognition/` directory exists with correct files
- [ ] Routes are thin (no direct LLM calls, no direct complex DB logic)
- [ ] `tsc --noEmit` passes with zero errors
- [ ] `lib/workflow-coordinator.ts` is deleted (replaced by `start-hcr-workflow.ts`)

---

## Appendix A: File Change Summary

| Action | File | Reason |
|--------|------|--------|
| DELETE | `app/api/chat/route.ts` | Broken, replaced by project-scoped route |
| DELETE | `lib/workflow-coordinator.ts` | Replaced by `start-hcr-workflow.ts` |
| RENAME | `app/inngest/functions/agent.ts` → `hcr-agent.ts` | Clarity |
| REWRITE | `app/api/projects/[id]/discovery/route.ts` | Thin route, delegates to runtime |
| REWRITE | `app/api/projects/[id]/chat/route.ts` | Uses new HCR workflow starter |
| REWRITE | `app/api/projects/route.ts` | Correct schema for domain-first project creation |
| REWRITE | `lib/context-engine.ts` → `src/cognition/context-engine.ts` | Artifact-aware |
| FIX+MOVE | `lib/discovery-agent.ts` → `src/cognition/discovery-agent.ts` | Bug fixes + restructure |
| CREATE | `src/runtime/artifacts/create-artifact.ts` | Central artifact creation |
| CREATE | `src/runtime/artifacts/get-artifact.ts` | Artifact retrieval |
| CREATE | `src/runtime/workflows/discovery/start-discovery-workflow.ts` | Discovery runtime |
| CREATE | `src/runtime/workflows/discovery/complete-discovery-workflow.ts` | Discovery completion |
| CREATE | `src/runtime/workflows/hcr/start-hcr-workflow.ts` | HCR runtime starter |
| MOVE | `lib/llm.ts` → `src/cognition/llm.ts` | Layer separation |
| MOVE | `lib/system-prompt.ts` → `src/cognition/system-prompt.ts` | Layer separation |
| MOVE | `lib/types.ts` → `src/shared/types.ts` | Shared contracts |
| MOVE | `lib/validations/*` → `src/shared/validations/*` | Layer separation |

## Appendix B: Environment Variables Required

No new env vars needed for Phase 4. Existing vars:
- `DATABASE_URL` — Neon PostgreSQL connection
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — Clerk auth
- `CLERK_SECRET_KEY` — Clerk auth
- `CLERK_WEBHOOK_SECRET` — Clerk webhooks
- `OPENROUTER_API_KEY` — LLM + embeddings
- `MODEL` — LLM model name (e.g., `openai/gpt-4o`)
- `MAX_ITERATIONS` — Max agent loop iterations (default: 12)

## Appendix C: Key Decisions and Rationale

**Why is Discovery synchronous but HCR async?**
Discovery is conversational — the user expects an instant response to each message. HCR involves potentially dozens of tool calls over minutes. HTTP timeout makes async mandatory for HCR.

**Why does `createArtifact()` auto-increment version by querying DB?**
Simplicity. For single-tenant workloads, this is safe. Multi-tenant at scale would need database-level sequences or optimistic locking — that's Phase 6+ territory.

**Why keep ProjectMemory alongside Artifacts?**
ProjectMemory stores lightweight summaries and serves as a quick lookup for project domain/status. It is NOT cognition — it's metadata. Artifacts are cognition. Both serve different purposes.

**Why filter messages by MessagePhase?**
Discovery chat and build chat are separate contexts. Mixing them would give the coding agent irrelevant discovery conversation history, and give the discovery agent confusing build-phase tool call history. Phase separation ensures each agent only sees relevant turns.

**Why NOT populate `parentArtifactId` in Phase 4?**
The versioning via `version` integer is sufficient for "get latest" queries. Building the parent-child graph traversal system requires more infrastructure (cycle detection, ordering queries, etc.) and has no immediate value in Phase 4. The field exists in the schema for when it's needed.
