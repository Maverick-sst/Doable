# AGENT_04 — Context Engine Completion

## Objective

Finish the current Context Engine migration so that the existing runtime has a single, stable, explicit context boundary.

This is the final **Context Engine V1/runtime-boundary** pass.

The goal is NOT to build Context Engine V2. The goal is to complete ownership of the context sources that already exist in the current runtime, prove behavioral parity, remove only compatibility seams that are now demonstrably dead, and then lock the subsystem before moving to the Model Router.

> **Core principle:** Complete the existing context boundary. Do not expand the context problem during this task.

---

# 1. Current State

The Context Engine has already been extracted and made runtime-facing.

Current flow:

```text
Node Executor
      │
      │ ContextRequest
      │ + CallerContextInputs
      ▼
Context Engine
      │
      ├── artifact retrieval
      ├── semantic-file retrieval
      └── context assembly
      │
      ▼
ContextResult
      │
      ▼
Node Executor → LLM
```

The runtime-facing contract was introduced in:

```text
src/hcr/context-engine/engine.ts
```

The current public entry point is:

```ts
buildContext(
  request: ContextRequest,
  callerInputs: CallerContextInputs,
): Promise<ContextResult>
```

The assembler remains pure.

The compatibility facade in:

```text
src/cognition/context-engine.ts
```

still exists intentionally.

The existing context map and deferred architecture documents are the source of truth for the already-identified seams.

---

# 2. Final Target

The final Context Engine V1 boundary should look like:

```text
                    ┌──────────────────┐
                    │   Agent Config   │
                    │       WHO        │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  Node Executor   │
                    │ execution loop  │
                    └────────┬─────────┘
                             │
                      ContextRequest
                             │
                             ▼
              ┌────────────────────────────┐
              │      CONTEXT ENGINE        │
              │                            │
              │  1. Resolve Context        │
              │     ├─ artifacts           │
              │     ├─ project files       │
              │     ├─ semantic files      │
              │     ├─ message history     │
              │     ├─ scratchpad          │
              │     └─ tool history        │
              │                            │
              │  2. Apply existing policy  │
              │                            │
              │  3. Assemble               │
              │                            │
              └─────────────┬──────────────┘
                            │
                      ContextResult
                            │
                            ▼
                           LLM
```

The important architectural result is:

> Node Executor owns execution. Context Engine owns context reconstruction and assembly.

---

# 3. Scope

## In scope

Complete ownership of the **existing** context sources:

- consumed artifact retrieval
- project file-list retrieval
- semantic/relevant-file retrieval
- message-history retrieval
- current-task propagation
- scratchpad propagation
- tool-history propagation
- existing context policy interpretation
- final context assembly
- runtime parity validation
- removal of compatibility seams that are proven dead

## Explicitly out of scope

Do NOT implement:

- Context Engine V2
- retrieval ranking
- importance scoring
- generalized retrieval framework
- architectural memory
- project summaries
- summarization
- context compaction
- Git history retrieval
- dependency graph retrieval
- code graph retrieval
- execution-history retrieval
- failure-history retrieval
- memory-provider migration
- prompt-cache architecture
- embedding-provider abstraction
- new vector database
- model router
- provider routing
- tool registry
- Temporal redesign
- Inngest removal
- agent registry redesign
- new agent types
- sandbox redesign
- token-budget optimizer

If a future requirement is discovered during implementation, document it instead of expanding scope.

---

# 4. Ownership Model

Keep these boundaries strict.

## Agent Config

Owns:

```text
WHO is the agent?
```

Examples:

- agent type
- instructions
- capabilities
- tool policy
- model policy
- execution policy

Context Engine must NOT import the Agent Registry to discover prompts or configuration.

---

## Node Executor

Owns:

```text
HOW does the agent execute?
```

Examples:

- execution loop
- LLM invocation
- tool execution
- iteration state
- artifact creation
- completion/failure handling

Node Executor should not implement context retrieval logic.

---

## Context Engine

Owns:

```text
WHAT context does this execution need right now?
```

It should:

1. receive an explicit request
2. resolve context sources
3. apply existing context policy
4. assemble model-facing messages
5. return `ContextResult`

---

## Temporal / Inngest

Own:

```text
WHEN / HOW does execution survive and coordinate?
```

Do not modify orchestration in this task.

---

# 5. Step 1 — Move Remaining Context Retrieval Behind the Engine

The current Context Map identifies caller-owned retrieval as a remaining seam.

Move these existing retrieval responsibilities behind the Context Engine:

### A. Project file list

Currently retrieved by `node-executor`.

Move the retrieval/query responsibility into a Context Engine retriever.

The retriever should preserve:

- existing project scope
- existing selected fields
- existing ordering/behavior
- existing empty-project behavior

Do not change the data source.

Do not introduce a new repository abstraction unless the current code genuinely requires one.

---

### B. Message history

Currently retrieved by `node-executor`.

Move the existing history query into a Context Engine retriever.

Preserve:

- project scope
- BUILD phase filtering
- existing fetch limit
- existing ordering
- existing reversal behavior
- existing role conversion
- existing dormant policy behavior

Important:

`includeMessageHistory` is currently disabled in the existing registry configurations.

Do NOT enable it globally.

The migration must preserve the current default behavior.

---

### C. Semantic/relevant files

This already belongs to the Context Engine.

Keep its existing behavior:

- `EMBEDDING_SUCCESSFUL`
- project scoped
- pgvector similarity
- top 5
- 700-character snippet
- existing empty embedding behavior

Do not alter ranking or retrieval semantics.

---

### D. Consumed artifacts

This already belongs to the Context Engine.

Keep:

- latest version selection
- requested artifact types
- project scope
- existing rendering

Do not redesign artifact retrieval.

---

# 6. Step 2 — Keep Embedding Generation Outside the Engine

Do NOT move the embedding provider call into the Context Engine during this task.

The current architecture may continue to do:

```text
Node Executor
      │
      ├── getEmbeddings(prompt)
      │
      ▼
Context Engine
      │
      └── promptEmbedding
```

The Context Engine may consume the already-generated embedding.

This deliberately keeps provider/model concerns outside the Context Engine.

Do not introduce:

- embedding provider interfaces
- embedding model selection
- embedding caching
- provider routing

Those belong to later work.

---

# 7. Step 3 — Introduce an Internal Resolved Context

Introduce a small internal representation between retrieval and assembly if useful.

Conceptually:

```ts
interface ResolvedContext {
  artifacts: ResolvedArtifact[];
  files: ...;
  relevantFiles: RelevantFileContext[];
  messages: LLmMessage[];
  toolHistory: ...;
  currentTask: string;
  scratchpad: string[];
}
```

This is an internal representation.

It does NOT need to become a public API.

The desired pipeline is:

```text
ContextRequest
      ↓
resolveContext()
      ↓
ResolvedContext
      ↓
assembleContext()
      ↓
ContextResult
```

Do not over-design this type.

Only include information already required by the current assembler.

---

# 8. Step 4 — Make Task Semantics Explicit

There are currently multiple task-like values:

```text
ContextRequest.task
currentContext.currentTask
prompt
```

Do not leave them as competing implicit sources of truth.

For this task establish the following semantics:

```text
prompt
  = original/current user execution prompt

task
  = current task the agent is executing

currentContext
  = runtime execution state containing task-adjacent state
```

The Context Engine should receive the authoritative task through `ContextRequest.task`.

The assembler should not independently decide between:

```ts
currentContext.currentTask || prompt
```

without an explicit reason.

Preserve existing first-pass behavior:

```text
task == prompt
```

when that is what the current runtime provides.

For iterative tool execution, preserve the current task semantics exactly.

If changing the source of the task would alter runtime behavior, stop and document the discrepancy rather than silently changing it.

---

# 9. Step 5 — Preserve Assembly Semantics

The following message order is an invariant:

```text
[
  system(nodeConfig.systemPrompt),
  user(
    artifacts
    + CURRENT TASK
    + file tree
    + relevant files
    + scratchpad
  ),
  ...historyMessages,
  ...toolMessages,
  user(prompt)
]
```

Do not reorder these messages.

Preserve:

### Artifacts

```text
=== PROJECT <TYPE> (Version <v>) ===
<pretty JSON>
```

### Current task

```text
=== CURRENT TASK ===
...
```

### File tree

Only when:

```text
includeFileTree === true
```

### Relevant files

Only when:

```text
includeVectorSearch === true
AND
promptEmbedding.length > 0
```

Preserve:

- top 5
- 700-char snippets
- existing empty-result behavior

### Scratchpad

Only in:

```text
tool_calls
```

mode.

Preserve:

```text
last 8 steps
```

### Message history

Only when:

```text
includeMessageHistory === true
```

### Tool history

Only in:

```text
tool_calls
```

mode.

### Final prompt

Always preserve:

```text
user(prompt)
```

as the final model-facing user message.

---

# 10. Step 6 — Keep the Assembler Pure

`assembler.ts` must remain:

```text
pure input → output
```

It must not:

- query Prisma
- call embedding APIs
- access Redis
- call LLMs
- access Agent Registry
- perform filesystem operations
- perform network calls

All retrieval happens before assembly.

---

# 11. Step 7 — Compatibility Facade

Keep:

```text
src/cognition/context-engine.ts
```

only as long as it has real consumers.

Its role is:

```text
legacy caller
      ↓
Context Engine
      ↓
ContextResult.messages
```

It must not regain knowledge of individual retrievers.

Do not reintroduce:

```ts
retrieveArtifacts(...)
retrieveRelevantFiles(...)
assembleContext(...)
```

into the compatibility facade.

---

# 12. Step 8 — Remove Dead Seams Only After Validation

Two known seams exist:

## `inputArtifactContent`

It has already been identified as dead.

However:

- verify every caller
- verify there is no hidden runtime dependency
- remove the parameter only after call sites are updated
- remove the now-dead resolution work if it becomes unnecessary

Do not perform speculative cleanup outside this seam.

---

## Legacy `buildContext()` wrapper

The old compatibility wrapper is known to be tied to a dead `hcr-agent` path.

Before removing it:

1. search the repository for all consumers
2. confirm there are no runtime callers
3. remove the wrapper
4. remove associated imports
5. remove dead tests only if they specifically cover the dead path

Do not delete it merely because it looks unused.

---

# 13. Runtime Migration Requirements

`node-executor.ts` must no longer perform context retrieval directly.

After completion, the runtime should conceptually do:

```ts
const context = await contextEngine.buildContext(
  request,
  runtimeInputs,
);

const response = await callLLM(
  context.messages,
  tools,
);
```

The exact local naming may differ.

The important invariant is:

> Node Executor requests context; it does not know how context is retrieved.

Both execution paths must use the same Context Engine boundary:

```text
structured_json
tool_calls
```

Do not create separate context engines for the two modes.

---

# 14. Testing Requirements

Testing must cover both the pure and runtime-facing layers.

## A. Existing assembler tests

Keep all existing behavior tests.

Do not remove them.

---

## B. Retriever tests

Cover:

### Artifact retrieval

- requested artifact types
- latest version
- empty result

### File retrieval

- project scope
- expected file fields
- empty project

### Relevant-file retrieval

- embedding gate
- project scope
- top 5
- truncation
- no successful embeddings

### Message history

- BUILD phase
- limit
- ordering
- role conversion
- disabled policy

---

## C. Runtime contract tests

Verify:

```text
Node Executor
    ↓
Context Engine
```

for both:

```text
structured_json
tool_calls
```

Verify that:

- execution identity reaches the request
- agent type is mapped correctly
- policy is preserved
- caller state is preserved
- prompt is preserved
- task semantics are preserved
- output is unchanged

---

## D. Parity tests

Where practical, construct equivalent inputs for:

```text
old assembly behavior
vs.
new Context Engine behavior
```

and verify identical `LLmMessage[]`.

The purpose is regression protection, not redesign.

---

# 15. Agent Config Invariant

Do not change the six existing Agent Config roles:

```text
ARCHITECT
RESEARCH
PRD_REVIEWER
PLANNER
FRONTEND_ENG
BACKEND_ENG
```

Do not:

- add agents
- rename agents
- alter prompts
- redesign registry structure
- introduce YAML

The Context Engine must remain independent of Agent Registry ownership.

---

# 16. No Model Router Work Yet

Do not introduce any model-routing logic in this task.

The eventual boundary should remain:

```text
Context Engine
       │
       ▼
model-facing messages
       │
       ▼
Model Router
       │
       ▼
provider/model
```

The Context Engine answers:

> What context should be sent?

The Model Router will later answer:

> Which model/provider should receive it?

Keep these responsibilities separate.

---

# 17. No Temporal/Inngest Changes

Do not:

- migrate workflows
- create new Temporal workflows
- delete Inngest
- change retry policy
- change activity boundaries
- change heartbeat behavior
- introduce new orchestration semantics

This task is strictly about context ownership.

---

# 18. Documentation Updates

Update:

```text
src/hcr/context-engine/CONTEXT_MAP.md
src/hcr/context-engine/DEFERRED.md
```

so they accurately describe the post-completion architecture.

The documentation should clearly distinguish:

### Completed Context Engine V1

- existing context source retrieval
- policy gating
- context resolution
- assembly
- runtime contract

### Future Context Engine V2

- ranking
- semantic indexing improvements
- summaries
- architectural memory
- execution-state reconstruction
- graph retrieval
- failure history
- Git history
- generalized retrieval

Do not move future items into implementation merely because they appear in the documentation.

---

# 19. Likely Files

Expected files to inspect/change:

```text
src/hcr/context-engine/types.ts
src/hcr/context-engine/index.ts
src/hcr/context-engine/engine.ts
src/hcr/context-engine/assembler.ts

src/hcr/context-engine/retrievers/
    artifacts.ts
    relevant-files.ts
    files.ts              ← likely
    message-history.ts    ← likely

src/cognition/context-engine.ts
src/cognition/node-executor.ts

tests/hcr-context-engine.test.ts
```

Documentation:

```text
src/hcr/context-engine/CONTEXT_MAP.md
src/hcr/context-engine/DEFERRED.md
```

Do not modify unrelated subsystems unless required for a direct migration.

---

# 20. Implementation Constraints

Follow these constraints strictly.

### Constraint 1 — No behavior redesign

This is an ownership migration.

If existing behavior is weird but intentional/current, preserve it.

---

### Constraint 2 — No speculative abstractions

Do not create:

- generic repository frameworks
- retrieval plugin systems
- provider registries
- memory abstractions
- ranking engines
- generic context DSLs

Build only what the current sources require.

---

### Constraint 3 — No giant ContextEngine class

Prefer small functions and explicit data flow.

The target is:

```text
request
  ↓
resolve
  ↓
assemble
  ↓
result
```

not:

```text
class ContextEngine {
  ...
}
```

unless the existing code genuinely requires stateful behavior.

---

### Constraint 4 — Preserve public boundary

The stable public boundary should remain:

```ts
buildContext(
  request: ContextRequest,
  callerInputs: CallerContextInputs,
): Promise<ContextResult>
```

If the implementation needs an internal helper, keep it internal.

---

### Constraint 5 — Do not move embedding provider ownership

Embedding generation remains outside.

---

### Constraint 6 — Do not modify Agent Config

Only consume its existing mapping where required.

---

### Constraint 7 — Do not touch model routing

Model Router is the next subsystem after Context Engine is locked.

---

# 21. Validation

Before declaring completion:

```bash
bun test
bunx tsc --noEmit
```

If the repository has focused Context Engine tests, run them independently as well.

Also perform repository searches for:

```text
buildNodeContext(
buildContext(
retrieveArtifacts(
retrieveRelevantFiles(
inputArtifactContent
```

Confirm that no unexpected caller still bypasses the Context Engine.

---

# 22. Completion Criteria

The task is complete only when all of the following are true:

- [ ] Context Engine owns all existing context-source retrieval.
- [ ] Node Executor no longer performs direct context retrieval.
- [ ] Embedding generation remains outside the engine.
- [ ] `ContextRequest` is the authoritative runtime request.
- [ ] Task semantics are explicit and consistent.
- [ ] Internal retrieval → resolved-context → assembly flow is clear.
- [ ] Assembler remains pure.
- [ ] Structured JSON path uses Context Engine.
- [ ] Tool-call path uses Context Engine.
- [ ] Existing message ordering is unchanged.
- [ ] Existing context policy behavior is unchanged.
- [ ] Artifact behavior is unchanged.
- [ ] File-tree behavior is unchanged.
- [ ] Semantic-file behavior is unchanged.
- [ ] Message-history behavior is unchanged.
- [ ] Scratchpad behavior is unchanged.
- [ ] Tool-history behavior is unchanged.
- [ ] Existing six Agent Config roles remain unchanged.
- [ ] Compatibility facade has no direct retrieval knowledge.
- [ ] Dead `inputArtifactContent` seam is removed only if proven safe.
- [ ] Legacy `buildContext()` wrapper is removed only if proven unused.
- [ ] Context Engine tests pass.
- [ ] Runtime-facing tests pass.
- [ ] `bun test` passes.
- [ ] `bunx tsc --noEmit` passes.
- [ ] Context Engine documentation reflects the final V1 boundary.
- [ ] No Model Router work is introduced.
- [ ] No Temporal/Inngest redesign is introduced.
- [ ] No Context Engine V2 functionality is introduced.

---

# 23. Suggested Commit

Use:

```text
refactor(hcr): complete context engine runtime boundary
```

Keep this as one coherent migration commit if practical.

If implementation naturally requires multiple commits, keep them narrowly scoped and preserve the same boundary.

---

# 24. Final Architectural Lock

When this task is complete, treat the Context Engine V1 boundary as **stable**.

The next subsystem should not modify Context Engine internals merely to make the Model Router easier to build.

The intended next boundary is:

```text
                 ┌─────────────────┐
                 │   Node Executor │
                 └────────┬────────┘
                          │
             ┌────────────┴────────────┐
             ▼                         ▼
      Context Engine              Model Router
             │                         │
             │ WHAT?                   │ WHICH?
             ▼                         ▼
      ContextResult              ModelRequest
             │                         │
             └────────────┬────────────┘
                          ▼
                       LLM Call
```

Context Engine should answer:

> **What does the model need to know right now?**

Model Router will answer:

> **Which model/provider should perform this operation?**

Do not merge these responsibilities.

---

# 25. Final Principle

This task is not about making the Context Engine smarter.

It is about making the Context Engine **complete, authoritative, testable, and stable**.

Once locked:

```text
Context Engine
      ↓
DONE
      ↓
Model Router
      ↓
next subsystem
```

Do not keep expanding the Context Engine while implementing the rest of the runtime.
