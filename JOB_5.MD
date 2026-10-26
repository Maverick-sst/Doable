# AGENT.md — Phase 5A HCR Implementation

## Mission

You are operating inside the Doable codebase.

Phase 4 established the foundational runtime:

- Workflows
- Executions
- Nodes
- Artifacts
- Runtime Events
- Discovery Engine
- Context Engine
- Tool System
- Filesystem Layer

Your responsibility is to implement **Phase 5A**.

Phase 5A is the first real implementation of the:

# Hierarchical Cognitive Runtime (HCR)

The goal is to evolve Doable from:

```txt
Architect
=
Entire Company
```

into:

```txt
Architect
        ↓
Researcher
        ↓
PRD Reviewer
        ↓
Staff Engineer
        ↓
Frontend Engineer
        ↓
Backend Engineer
```

while preserving every existing Phase 4 runtime guarantee.

---

# BEFORE TOUCHING ANY CODE

You must fully understand:

- PHASE_5.md
- existing workflow engine
- execution system
- node system
- artifact system
- runtime event system
- discovery workflow
- current HCR implementation
- current architect execution flow
- Prisma schema
- runtime orchestration patterns

Before modifying any file:

1. Read the entire file
2. Understand its purpose
3. Understand its dependencies
4. Preserve existing conventions
5. Preserve backward compatibility

You are extending a production runtime.

You are not rewriting one.

---

# PRIMARY OBJECTIVE

Implement Phase 5A exactly as defined.

The system currently behaves like:

```txt
chat/requested
        ↓
Architect
        ↓
Filesystem
```

The target system becomes:

```txt
chat/requested
        ↓
Architect
        ↓
Researcher
        ↓
PRD Reviewer
        ↓
Staff Engineer
        ↓
Frontend Engineer
        ↓
Backend Engineer
```

Each node must:

- own a responsibility
- consume artifacts
- produce artifacts
- execute independently
- remain observable

---

# CRITICAL PHILOSOPHY

Do NOT think:

```txt
Agents talking to agents
```

Think:

```txt
Artifacts flowing through cognition
```

The HCR is:

```txt
Artifact
        ↓
Node
        ↓
Artifact
        ↓
Node
        ↓
Artifact
```

Artifacts are the contract.

Artifacts are the source of truth.

Prompts are implementation details.

---

# PHASE 5A DELIVERABLES

---

# DELIVERABLE 1

## Node Execution Framework

Current state:

```txt
hcr-agent.ts
```

contains mixed responsibilities.

Likely includes:

- orchestration
- context assembly
- LLM execution
- tool execution
- artifact handling
- completion logic

This must evolve into a reusable:

```txt
Node Executor
```

concept.

Every cognitive node should share:

- context assembly
- runtime event emission
- artifact loading
- artifact persistence
- tool execution
- execution lifecycle
- completion handling

Only these should vary:

```txt
Prompt
Role
Artifact Types
Responsibilities
```

Goal:

```txt
Architect Executor
Researcher Executor
PRD Reviewer Executor
Staff Engineer Executor
Frontend Executor
Backend Executor
```

all built on top of the same execution foundation.

---

# DELIVERABLE 2

## Agent Registry

Current state:

Architect is effectively hardcoded.

Goal:

Introduce a runtime registry that defines:

```txt
Architect
Researcher
PRDReviewer
StaffEngineer
FrontendEngineer
BackendEngineer
```

The registry becomes the runtime source of truth for:

- node identity
- node role
- node configuration
- node artifact contracts
- execution routing

Avoid hardcoding node assumptions throughout the runtime.

---

# DELIVERABLE 3

## Artifact Contracts

Before multi-node cognition exists:

artifact contracts must be formalized.

Create explicit artifact definitions.

---

### ArchitectureSpec

Produced by:

```txt
Architect
```

Contains:

- project understanding
- architecture decisions
- execution strategy
- system boundaries
- implementation direction

---

### ResearchDossier

Consumes:

```txt
ArchitectureSpec
```

Produces:

```txt
ResearchDossier
```

Contains:

- implementation research
- framework decisions
- library recommendations
- risks
- alternatives
- technical findings

---

### ApprovedPRD

Consumes:

```txt
ResearchDossier
```

Produces:

```txt
ApprovedPRD
```

Contains:

- validated requirements
- clarified scope
- ambiguity resolution
- implementation readiness

---

### ExecutionPlan

Consumes:

```txt
ApprovedPRD
```

Produces:

```txt
ExecutionPlan
```

Contains:

- decomposition
- execution strategy
- FE tasks
- BE tasks
- dependency graph

---

### FrontendMutations

Consumes:

```txt
ExecutionPlan
```

Produces:

```txt
FrontendMutations
```

Contains:

- component work
- UI implementation
- file changes
- frontend execution outputs

---

### BackendMutations

Consumes:

```txt
ExecutionPlan
```

Produces:

```txt
BackendMutations
```

Contains:

- API work
- database work
- infrastructure work
- backend execution outputs

---

Artifact contracts must be:

- explicit
- typed
- versionable
- discoverable
- compatible with existing artifact lineage

Do not create ad-hoc structures.

---

# DELIVERABLE 4

## Artifact Driven Progression

Current:

```txt
Discovery
        ↓
Architect
        ↓
Complete
```

Target:

```txt
Discovery
        ↓
ArchitectureSpec
        ↓
ResearchDossier
        ↓
ApprovedPRD
        ↓
ExecutionPlan
        ↓
FrontendMutations
BackendMutations
```

Workflow transitions must be driven by:

```txt
Artifact Completion
```

NOT:

```txt
Prompt Completion
```

The presence of required artifacts should determine progression.

---

# DELIVERABLE 5

## Workflow Coordinator Evolution

Current state:

Workflow ends after Architect.

Target state:

```txt
Architect Completed
        ↓
Researcher Created

Researcher Completed
        ↓
PRD Reviewer Created

PRD Reviewer Completed
        ↓
Staff Engineer Created

Staff Engineer Completed
        ↓
Frontend Created
Backend Created
```

The coordinator becomes responsible for:

- node creation
- node scheduling
- node progression
- artifact routing
- dependency enforcement

Preserve existing workflow lineage.

Preserve existing execution lineage.

Do not bypass orchestration.

---

# WHAT YOU MUST PRESERVE

The following are already architectural pillars of Doable:

- workflows
- executions
- nodes
- artifacts
- runtime events
- lineage
- discovery
- context engine
- memory assumptions
- versioning assumptions

Do NOT replace them.

Do NOT create parallel systems.

Do NOT introduce alternative orchestration models.

Phase 5A must feel like a natural continuation of Phase 4.

---

# DO NOT BUILD YET

The following are explicitly out of scope:

```txt
Code Reviewer
Test Designer
QA Runtime
Repair Loops
Replayability
Prompt Caching
Optimization Runtime
Git Runtime
Deployment Runtime
CI/CD
Failure Intelligence
Sandboxing
Remote Execution
```

If implementation requires these:

STOP.

They belong to future phases.

---

# NON-NEGOTIABLE RULES

## DO NOT RUN COMMANDS

Under NO circumstances should you execute:

- bun run dev
- bun dev
- npm run dev
- pnpm dev
- npx
- prisma migrate
- prisma db push
- prisma generate
- docker
- shell scripts
- database commands
- installation commands
- destructive commands

You may ONLY:

- inspect files
- create files
- modify files

Nothing else.

---

# DATABASE RULES

Preserve:

- schema integrity
- existing relations
- workflow lineage
- execution lineage
- artifact lineage

Do NOT:

- remove fields
- rename fields carelessly
- break existing contracts
- alter runtime assumptions

Any schema change must be:

```txt
Additive
Backward Compatible
Migration Safe
```

---

# TYPESCRIPT RULES

All new code must:

- be strongly typed
- avoid any
- follow existing conventions
- remain deterministic
- remain composable

Favor:

- explicit interfaces
- small units
- reusable abstractions
- predictable execution

Avoid:

- giant files
- hidden mutations
- runtime magic
- overengineering

---

# RUNTIME SAFETY

Nothing should:

- corrupt artifacts
- orphan executions
- orphan nodes
- break workflow progression
- break event streams
- break lineage

All failures must remain recoverable.

All execution states must remain valid.

---

# WHEN UNSURE

Follow this order:

1. Existing codebase
2. PHASE_5.md
3. Existing runtime patterns
4. Smallest safe change
5. Maximum backward compatibility

Never invent a competing architecture.

---

# DEFINITION OF DONE

Phase 5A is complete when:

```txt
Architect
        ↓
Researcher
        ↓
PRD Reviewer
        ↓
Staff Engineer
        ↓
Frontend Engineer
        ↓
Backend Engineer
```

exist as independent cognitive nodes.

And:

- node execution is reusable
- artifact contracts exist
- artifact progression exists
- workflow transitions exist
- runtime observability remains intact
- lineage remains intact
- backward compatibility remains intact

Only then can Doable legitimately claim:

"The HCR Pipeline Exists."
