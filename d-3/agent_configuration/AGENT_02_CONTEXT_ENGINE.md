# Agent 02 — Context Engine

## Objective

Map, separate, and incrementally evolve Doable's existing context assembly into a durable Context Engine boundary **without changing agent intelligence, agent prompts, workflow orchestration, or runtime behavior unnecessarily**.

The goal of this task is **not** to build a speculative Context Engine V2 in one pass.

The goal is to establish a safe architectural boundary around the context capabilities that already exist, preserve their behavior, and create the contracts needed for later evolution toward:

- state reconstruction
- retrieval
- context selection
- context assembly
- prompt representation
- project/execution memory
- richer semantic retrieval

The implementation must be incremental and testable.

---

# 1. Source of Truth

Before modifying code, inspect the current branch and treat the following as authoritative implementation sources:

- `src/cognition/context-engine.ts`
- `src/cognition/node-executor.ts`
- `src/cognition/agent-registry.ts`
- `src/cognition/types/node-config.ts`
- `src/cognition/llm.ts`
- `app/inngest/functions/hcr-agent.ts`
- current Prisma schema and relevant models
- existing artifact creation/retrieval code
- existing file embedding/indexing code
- existing message persistence/retrieval
- existing runtime event/tool-completion code
- current tests
- the Agent Configuration implementation under `src/hcr/agent-config/`

Also inspect:

- `Doable V1 — Architecture & Execution Blueprint`
- existing architecture / migration documentation
- any current HCR migration map

Do not infer a behavior merely because it appears desirable in the target architecture. Verify whether it exists today.

---

# 2. Architectural Principle

Maintain this ownership split:

```text
Agent Configuration
    ↓
Context Policy
    ↓
Context Engine
    ↓
Agent Runtime
    ↓
Temporal Workflow
```

The responsibilities are distinct:

### Agent Configuration

Answers:

> Who is this agent?

Owns:

- agent identity
- role/instructions
- capabilities
- model policy references
- tool policy references
- execution policy references

Do not move context retrieval logic into Agent Configuration.

### Context Policy

Answers:

> What categories of information may/should this agent request?

Examples:

- consumed artifacts
- recent messages
- semantic files
- project state
- execution state
- architectural memory
- task-specific retrieval

Context policy is configuration, not retrieval implementation.

### Context Engine

Answers:

> What does this agent need to know for this task, right now?

Owns:

- state reconstruction
- retrieval
- context selection
- ranking/priority
- context assembly
- model-input representation

### Agent Runtime

Answers:

> What does the agent do with the context?

Owns:

- model invocation
- tool loop
- iteration
- tool execution
- output handling

### Temporal

Answers:

> When does each step happen, and how does it survive failure?

Owns:

- workflow sequencing
- retries
- durability
- timeouts
- cancellation
- orchestration

Do not collapse these boundaries.

---

# 3. Current Implementation — Preserve First

The current `src/cognition/context-engine.ts` provides:

```text
buildNodeContext(...)
buildContext(...)
```

`buildNodeContext()` currently assembles:

1. consumed artifacts
2. file tree
3. semantic file retrieval
4. optional message history
5. scratchpad
6. tool history
7. current task
8. original prompt
9. system prompt

The current output is:

```ts
LLmMessage[]
```

The existing ordering and semantics are behavior that must be preserved unless a migration explicitly documents otherwise.

The current implementation also performs direct Prisma access for artifact retrieval and semantic file retrieval.

Do not remove working behavior merely to make the architecture look cleaner.

---

# 4. Current Capabilities That Must Be Mapped

Before implementation, produce a concrete dependency map for:

## 4.1 Artifacts

Current behavior includes:

```ts
nodeConfig.contextConfig.consumedArtifactTypes
```

and retrieval of the latest artifact by:

```text
projectId
artifact type
highest version
```

Map:

- who produces the artifact
- who consumes it
- whether the latest-version assumption is valid
- whether node-specific artifact selection exists
- whether artifact content is structured JSON
- whether artifacts are persisted independently of Temporal

Do not redesign artifact storage in this task.

---

## 4.2 File Tree

Current behavior receives files from the caller and optionally serializes their paths into context.

Map:

- where the files are loaded
- whether the caller always has a fresh file list
- how filesystem mutations affect the list
- whether a context rebuild sees newly created files

Do not create a filesystem abstraction unless the current code requires it.

---

## 4.3 Semantic File Retrieval

Current behavior performs a direct pgvector query over `File.embedding`.

It currently:

- requires successful embeddings
- uses the prompt embedding
- filters by project
- orders by vector similarity
- retrieves a small top-K set
- truncates each file's content before injection

Map:

- embedding generation
- embedding persistence
- embedding status
- vector query
- top-K behavior
- content truncation
- caller expectations

Preserve the current behavior while extracting the responsibility behind a clean retrieval boundary.

Do not introduce a new vector database.

Do not introduce a new embedding model.

Do not change ranking semantics in the first extraction step.

---

## 4.4 Message History

Map:

- message persistence
- `MessagePhase.BUILD`
- ordering
- current limit
- where retrieval occurs
- where reversal occurs
- whether context engine or caller owns retrieval today

The current registered agent configs have message history disabled.

Do not enable it globally.

---

## 4.5 Scratchpad

Current scratchpad state is ephemeral:

```ts
{
  currentTask,
  iteration,
  scratchpad[]
}
```

Map:

- creation
- mutation
- lifecycle
- visibility
- persistence
- handoff behavior

Do not assume the scratchpad is durable memory.

Do not introduce persistence unless a separate task explicitly requires it.

---

## 4.6 Tool History

Map:

- assistant tool calls
- tool results
- tool call IDs
- runtime event logging
- tool completion handling
- in-memory history
- what survives process/workflow restart

The current engine converts tool history into LLM messages.

Preserve the model-facing representation during extraction.

Do not replace tool execution with a new abstraction in this task.

---

## 4.7 Current Task

Map the relationship between:

- original prompt
- `currentContext.currentTask`
- node task
- execution/node metadata
- artifacts
- workflow input

Do not invent a new task graph.

Document where the task actually comes from today.

---

# 5. Important Existing Inconsistencies to Document

The current code has several architectural seams.

Document them before fixing them.

## 5.1 Duplicate Artifact Paths

`buildNodeContext()` receives:

```ts
inputArtifactContent
```

but currently performs its own artifact retrieval based on:

```ts
nodeConfig.contextConfig.consumedArtifactTypes
```

Determine whether `inputArtifactContent` is legacy, transitional, or required by another caller.

Do not delete it without evidence.

---

## 5.2 `buildContext()` Compatibility Wrapper

`buildContext()` currently resolves the Architect configuration from `AGENT_REGISTRY` and delegates to `buildNodeContext()`.

This exists for the older HCR/Inngest path.

Do not remove it until all callers are identified and migration impact is understood.

If it becomes unused, remove it only in a separate, explicitly validated cleanup step.

---

## 5.3 Context Retrieval Outside the Context Engine

`node-executor.ts` currently retrieves:

- project/files
- recent messages

before calling the Context Engine.

The old HCR/Inngest path also performs initial context retrieval outside the engine.

Document these boundaries.

The target architecture may move retrieval behind the Context Engine, but the first implementation should not blindly move every Prisma query.

---

# 6. Target Conceptual Model

The target Context Engine should eventually look conceptually like:

```text
ContextRequest
      │
      ▼
State Reconstruction
      │
      ├── Project State
      ├── Execution State
      ├── Node/Task State
      └── Relevant Durable State
      │
      ▼
Retrieval
      │
      ├── Artifacts
      ├── Files
      ├── Messages
      ├── Memory
      ├── Events
      └── Future knowledge sources
      │
      ▼
Context Selection
      │
      ├── relevance
      ├── priority
      ├── recency
      ├── task scope
      └── context budget
      │
      ▼
Context Assembly
      │
      ▼
Model Context / LLmMessage[]
```

This is a target architecture, not a requirement to implement every box immediately.

---

# 7. Recommended Implementation Strategy

Use incremental extraction.

## Phase A — Inventory

Create a code-level map of:

```text
Context source
    ↓
Current owner
    ↓
Current storage
    ↓
Current retrieval method
    ↓
Current transformation
    ↓
Current consumers
```

Do this for:

- artifacts
- files
- semantic files
- messages
- scratchpad
- tool history
- execution events
- project state
- task state

Deliver the map before changing architecture.

---

## Phase B — Introduce Contracts

Define minimal internal contracts for:

### ContextRequest

Conceptually:

```ts
{
  projectId;
  executionId?;
  nodeId?;
  agentType;
  task;
  prompt;
  policy;
}
```

Use actual existing IDs where available.

Do not introduce IDs merely because the target architecture mentions them.

### ContextResult

Keep the model-facing representation compatible with current runtime needs.

Do not prematurely create a large generalized schema.

### Retrieval boundary

Introduce a small internal retrieval interface for existing sources.

Example concept:

```ts
retrieveArtifacts(...)
retrieveFiles(...)
retrieveMessages(...)
```

The exact names and shapes should follow existing repository conventions.

---

# 8. Extraction Rule

The first implementation should preserve behavior.

For example:

```text
OLD

buildNodeContext()
    ├── Prisma artifact query
    ├── pgvector query
    ├── message transformation
    ├── scratchpad transformation
    ├── tool-history transformation
    └── prompt assembly
```

becomes approximately:

```text
Context Engine
    │
    ├── Artifact Retriever
    ├── File Retriever
    ├── Message Retriever
    ├── Execution Context
    └── Context Assembler
```

The first extraction must produce materially equivalent `LLmMessage[]`.

Do not add new retrieval sources during this extraction.

---

# 9. State Reconstruction — Future Boundary

The architecture blueprint identifies state reconstruction as a major future concern.

For this task, define the boundary but do not attempt to build the complete system.

Potential state sources include:

- project record
- execution record
- node record
- runtime events
- artifacts
- files
- messages
- tool history

The eventual question is:

> Given a project, execution, node, and task, what is the current durable state?

Do not solve this by dumping every database record into the prompt.

---

# 10. Retrieval — Future Direction

The Context Engine should eventually provide a generalized retrieval layer.

Potential sources:

```text
Files
Artifacts
Messages
Memory
Runtime events
Git history
Dependency information
Architectural memory
Research
```

But only the sources that actually exist should be implemented.

Do not create fake providers for future systems.

---

# 11. Context Selection — Future Direction

The current implementation mostly uses binary flags:

```text
includeFileTree
includeVectorSearch
includeMessageHistory
```

The target should eventually support more intentional selection.

For example:

```text
required
relevant
optional
deferred
```

or an equivalent repository-native representation.

Do not implement a complex scoring/ranking algorithm yet.

First establish the data boundaries.

---

# 12. Context Budgeting

The current system has hard-coded limits such as:

- top 5 semantic files
- ~700 characters per retrieved file
- last 8 scratchpad entries
- recent message limit of 10

Document these values and where they are applied.

Do not invent a token-budgeting system in this task.

The future Context Engine may need:

```text
token budget
priority
compression
summarization
truncation
```

but those are deferred unless the existing code requires them.

---

# 13. Prompt Cache Awareness

The eventual assembly model should preserve stable content before dynamic content where practical.

Conceptually:

```text
Stable
  ↓
system instructions
stable agent context
stable project context
  ↓
Dynamic
  ↓
task
recent events
tool results
current files
```

However:

**Do not restructure the current prompt ordering solely for cache optimization in this task.**

First preserve behavior and establish boundaries.

---

# 14. Agent Handoff

Doable already has artifact-based handoffs:

```text
ARCHITECT
   ↓
ARCHITECTURE_SPEC
   ↓
RESEARCH
```

and:

```text
PLANNER
   ↓
EXECUTION_PLAN
   ↓
FRONTEND_ENG / BACKEND_ENG
```

The Context Engine should eventually provide each agent a task-specific view of shared durable state.

It should NOT rebuild the entire project context independently for every agent.

Do not build a new handoff system in this task.

---

# 15. Explicit Non-Goals

Do NOT implement:

- new LLM providers
- model routing
- YAML agent configuration
- new agent roles
- Temporal workflow redesign
- Inngest removal
- new vector database
- new embedding model
- memory-provider migration
- full architectural memory system
- code graph
- dependency graph
- Git intelligence
- automatic summarization
- sophisticated context ranking
- token optimization platform
- prompt-cache infrastructure
- new tool execution system
- new artifact storage
- new filesystem abstraction
- speculative Cortex components

Those belong to later, explicitly scoped tasks.

---

# 16. Testing Requirements

Every extraction must have tests proving that existing behavior remains intact.

At minimum test:

### Artifact retrieval

- correct project
- correct artifact type
- latest version
- absent artifact

### File retrieval

- project isolation
- successful embeddings only
- semantic ordering
- top-K behavior
- content truncation

### Message context

- enabled behavior
- disabled behavior
- ordering

### Scratchpad

- empty scratchpad
- recent entries
- last-8 behavior

### Tool history

- assistant tool calls
- tool results
- tool call IDs
- empty history

### Context assembly

- system prompt
- user context
- original prompt
- ordering of message groups

### Agent-specific behavior

Verify all existing six agent configurations continue to receive the context they currently receive.

Do not silently broaden context for agents.

---

# 17. Regression Requirements

Before merging:

- existing tests must pass
- TypeScript typecheck must pass
- no existing prompt constants may change
- no agent catalog changes
- no Temporal workflow behavior changes
- no Inngest workflow behavior changes
- no artifact schema changes
- no Prisma migration unless explicitly required
- no change to tool names
- no change to tool execution semantics

The branch must remain rollback-safe.

---

# 18. Git / Agent Safety Rules

This task must be executed on a dedicated branch.

The agent must:

1. inspect before editing
2. make small commits
3. keep changes limited to Context Engine scope
4. avoid unrelated formatting changes
5. avoid modifying agent prompts
6. avoid modifying Temporal orchestration
7. avoid modifying production workflow behavior unless required by extraction
8. run targeted tests after each meaningful extraction
9. run full tests/typecheck before completion
10. report all files changed

If an architectural ambiguity is discovered, document it instead of guessing.

---

# 19. Deliverables

The implementation agent must produce:

### Deliverable 1 — Code Map

A concise document identifying:

```text
Context source
Current owner
Storage
Retrieval
Transformation
Consumers
```

### Deliverable 2 — Context Contracts

Minimal typed contracts for the Context Engine boundary.

### Deliverable 3 — Extracted Retrieval Boundaries

Only for capabilities that already exist:

- artifacts
- files
- messages where appropriate

### Deliverable 4 — Context Assembly Boundary

A clean assembly layer preserving the existing model-facing behavior.

### Deliverable 5 — Tests

Regression tests for all preserved behavior.

### Deliverable 6 — Deferred Architecture Notes

Explicitly record future work that was intentionally not implemented:

- state reconstruction
- memory
- ranking
- budgeting
- graph retrieval
- summaries
- Git history
- architectural memory

---

# 20. Completion Criteria

The task is complete when:

```text
Existing Context Behavior
        ↓
is represented behind
        ↓
a clean Context Engine boundary
        ↓
without changing agent behavior
        ↓
and without expanding scope into
future Context Engine V2 systems.
```

The resulting architecture should make it possible for a later task to add:

```text
State Reconstruction
        +
General Retrieval
        +
Context Selection
        +
Memory
        +
Context Budgeting
```

without rewriting the agent runtime.

---

# Final Principle

**Do not build the Context Engine we imagine. First isolate the Context Engine Doable already has.**

Preserve cognition.

Separate ownership.

Extract existing behavior.

Create contracts.

Then evolve.
