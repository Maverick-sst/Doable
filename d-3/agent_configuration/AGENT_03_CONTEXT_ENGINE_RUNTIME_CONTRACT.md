# AGENT 03 — Context Engine Runtime Contract

## Objective

Make the newly extracted Context Engine boundary a real runtime contract without redesigning the Context Engine.

The previous Context Engine work established:

- explicit retrievers for artifacts and relevant files
- a pure `assembleContext()` boundary
- regression tests for existing prompt/context behavior
- a documented context-source map
- explicit deferred architecture
- `buildNodeContext()` delegation through the extracted boundary

This phase turns the conceptual:

`ContextRequest → Context Engine → ContextResult`

into the actual runtime seam.

The central rule is:

> Introduce the contract first. Preserve the existing context behavior exactly.

Do not use this phase to build Context Engine V2.

---

# 1. Source of Truth

Primary implementation sources:

- `src/cognition/context-engine.ts`
- `src/cognition/node-executor.ts`
- `src/cognition/types/node-config.ts`
- `src/hcr/context-engine/types.ts`
- `src/hcr/context-engine/assembler.ts`
- `src/hcr/context-engine/retrievers/artifacts.ts`
- `src/hcr/context-engine/retrievers/relevant-files.ts`
- `tests/hcr-context-engine.test.ts`
- `src/hcr/context-engine/CONTEXT_MAP.md`
- `src/hcr/context-engine/DEFERRED.md`

Also inspect the existing HCR/Temporal execution path before changing callers.

Do not infer new behavior that is not supported by the existing implementation.

---

# 2. Current State

The extracted Context Engine currently has two layers.

### Actual runtime path

`node-executor → buildNodeContext() → retrievers → assembleContext() → LLmMessage[]`

### Conceptual contract already defined

```ts
interface ContextRequest {
  projectId: string;
  executionId?: string;
  nodeId?: string;
  agentType: AgentType;
  task: string;
  prompt: string;
  policy: ContextPolicy;
}

interface ContextResult {
  messages: LLmMessage[];
}
```

The important gap is that these interfaces are currently descriptive rather than the actual runtime API.

The objective of this phase is to close that gap safely.

---

# 3. Architectural Ownership

## Agent Config

Owns:

- who the agent is
- agent type
- instructions
- capabilities
- tool policy
- model policy
- execution policy

Does not own context retrieval.

## Context Engine

Owns:

- interpreting a context request
- context-specific retrieval
- context assembly
- producing model-facing context

Does not own:

- agent instructions
- LLM invocation
- tool execution
- workflow orchestration
- artifact persistence
- source-of-truth state

## Agent Runtime / Node Executor

Owns:

- executing a configured agent/node
- tool loop
- current ephemeral execution state
- calling the model
- applying model output
- artifact creation
- node lifecycle

The runtime should request context rather than reconstructing context itself.

## Temporal

Owns:

- durable orchestration
- workflow progression
- activity execution
- retries
- recovery
- sequencing

Temporal should not contain context assembly logic.

---

# 4. Target Runtime Boundary

The target shape for this phase is:

```text
Node Executor
      │
      │ ContextRequest
      ▼
Context Engine
      │
      ├── retrieveArtifacts()
      ├── retrieveRelevantFiles()
      └── assembleContext()
      │
      │ ContextResult
      ▼
Node Executor
      │
      ▼
LLM
```

The Context Engine should become the single entry point for context construction.

Avoid exposing the internal retrievers to runtime callers once the boundary is established.

---

# 5. ContextRequest Design

Use the existing `ContextRequest` as the starting contract.

Required identity:

```ts
projectId
```

Execution correlation:

```ts
executionId?
nodeId?
```

Agent identity:

```ts
agentType
```

Task information:

```ts
task
prompt
```

Context policy:

```ts
policy
```

Do not add speculative fields such as:

- token budgets
- memory providers
- retrieval ranking
- model selection
- summaries
- cache configuration
- graph queries
- Git history
- embedding configuration

Those belong to later phases.

### Important distinction

`task` and `prompt` may currently contain the same value.

Do not invent semantics for them beyond what the current runtime supports.

If the implementation cannot meaningfully distinguish them yet, preserve the existing caller behavior and document that they are currently equivalent.

---

# 6. ContextResult Design

The current model-facing representation is:

```ts
LLmMessage[]
```

The existing `ContextResult` wrapper:

```ts
interface ContextResult {
  messages: LLmMessage[];
}
```

should become the boundary returned by the Context Engine.

Do not add:

```text
metadata
token counts
ranking explanations
retrieval scores
debug traces
cache keys
```

unless the current implementation already provides them.

The first runtime contract should stay minimal.

---

# 7. Introduce One Context Engine Entry Point

Create a single public function at the new boundary, for example:

```ts
buildContext(request, callerInputs): Promise<ContextResult>
```

or an equivalent name that fits the existing codebase.

The exact API shape may differ if the current code makes a safer structure necessary.

The important property is:

> Runtime callers should invoke one Context Engine entry point rather than importing individual retrievers or the assembler.

Internally:

```text
Context Engine entry point
        │
        ├── policy evaluation
        ├── artifact retrieval
        ├── relevant-file retrieval
        └── assembly
```

Keep the implementation functional unless the existing codebase clearly requires a class/service.

---

# 8. Caller-Owned Ephemeral Inputs

The current extraction intentionally leaves these outside the Context Engine:

```text
files
messages
toolHistory
currentContext
promptEmbedding
```

Do not automatically move them in this phase.

Instead, define how they cross the boundary.

A safe transitional model is:

```ts
buildContext(
  request: ContextRequest,
  callerInputs: CallerContextInputs
): Promise<ContextResult>
```

This allows the boundary to become real without simultaneously redesigning retrieval.

Document that `CallerContextInputs` is transitional.

The eventual direction is:

```text
ContextRequest
        ↓
Context Engine reconstructs/retrieves what it needs
```

but that is not this phase.

---

# 9. Agent Type Handling

The request contains:

```ts
agentType: AgentType
```

Do not use this field to create a second agent registry.

The Context Engine may use agent type for:

- tracing
- request correlation
- future context policy selection

It should not independently decide:

```text
ARCHITECT → special prompt
FRONTEND_ENG → special prompt
```

Agent instructions remain outside the Context Engine.

The existing `NodeConfig` remains the current compatibility source for:

- `systemPrompt`
- `outputMode`
- `contextConfig`

Do not remove these fields yet.

---

# 10. System Prompt Boundary

The current assembler receives:

```ts
systemPrompt
```

Keep this explicit.

Do not make the Context Engine import:

```text
AGENT_REGISTRY
```

to discover prompts.

The runtime already has the node/agent configuration.

Therefore:

```text
Agent Config
     │
     └── systemPrompt
             │
             ▼
       Context Engine
```

is the correct transitional direction.

This prevents the Context Engine from becoming an Agent Registry.

---

# 11. Prompt Embedding Boundary

Current behavior generates the prompt embedding in `node-executor`.

Preserve this for this phase.

The request/caller boundary should therefore continue to allow:

```ts
promptEmbedding: number[]
```

through `CallerContextInputs`.

Do not introduce an embedding provider abstraction yet.

Do not move embedding generation into the Context Engine until retrieval ownership is explicitly migrated.

Also preserve the current behavior that structured agents may generate an embedding even when vector search is disabled.

The optimization is deferred.

---

# 12. Migration of `buildNodeContext`

`src/cognition/context-engine.ts` currently acts as a compatibility facade.

The goal is to change it from:

```text
buildNodeContext
    ↓
retrievers
    ↓
assembler
```

to either:

```text
buildNodeContext
    ↓
new Context Engine public entry point
```

or, if safe:

```text
node-executor
    ↓
new Context Engine public entry point

buildNodeContext
    ↓
compatibility wrapper
```

Prefer the smallest change that makes the new contract real.

Do not delete `buildContext()` in this phase.

Do not delete `inputArtifactContent` in this phase.

Those are separately documented cleanup seams.

---

# 13. Node Executor Migration

The runtime currently constructs context by directly calling:

```ts
buildNodeContext(...)
```

Change the call site so the runtime constructs an explicit `ContextRequest`.

The request should contain:

```text
projectId
executionId
nodeId
agentType
task
prompt
policy
```

Use the existing node configuration to populate these values.

Then pass the transitional caller-owned inputs separately.

Conceptually:

```ts
const contextRequest = {
  projectId,
  executionId,
  nodeId,
  agentType: resolveAgentType(...),
  task: currentContext.currentTask,
  prompt,
  policy: nodeConfig.contextConfig,
};

const context = await contextEngine.buildContext(
  contextRequest,
  callerInputs,
);
```

Do not redesign the execution loop.

The returned messages should still be used exactly where `contextMessages` are currently used.

---

# 14. Structured JSON Path

Preserve:

```text
embedding
→ context
→ LLM
→ parse
→ validate
→ artifact
```

Only the context construction call changes.

The retry behavior must remain unchanged.

Do not modify:

- JSON extraction
- artifact validation
- retry count
- artifact creation
- node completion
- Inngest completion behavior

---

# 15. Tool-Call Path

Preserve:

```text
embedding
→ project/file retrieval
→ context
→ LLM
→ tool execution
→ tool history
→ scratchpad
→ context again
```

The context engine should be called once per loop iteration exactly as before.

Do not move the tool loop into the Context Engine.

The Context Engine prepares context.

The Node Executor executes.

---

# 16. Context Engine Purity

The public Context Engine function may perform retrieval.

The assembler must remain pure.

Maintain:

```text
Context Engine
    ├── retrieval
    └── assembly

Assembler
    └── pure transformation
```

Do not put LLM calls inside the Context Engine.

Do not put tool execution inside it.

Do not mutate execution/node state from the assembler.

---

# 17. Compatibility Guarantees

After migration, the following must remain unchanged:

### Message ordering

```text
system
user context blob
history
tool history
final user prompt
```

### Artifact selection

Latest artifact version per consumed type.

### Relevant file retrieval

- successful embeddings only
- project scoped
- vector similarity
- top 5
- 700-character snippet

### File tree

Same path ordering received from caller.

### History

Same caller-provided messages and role normalization.

### Scratchpad

Last 8 entries.

### Tool history

Same assistant/tool message mapping.

### Empty behavior

Preserve current empty-section behavior.

---

# 18. Tests

Add tests for the actual boundary, not just the assembler.

At minimum:

## Context Engine entry point

- accepts a valid `ContextRequest`
- returns `ContextResult`
- delegates to existing retrieval/assembly behavior

## Caller input propagation

Verify that:

- files reach assembly
- messages reach assembly
- tool history reaches assembly
- current context reaches assembly
- prompt embedding reaches relevant-file retrieval

## Identity propagation

Verify the request can carry:

```text
projectId
executionId
nodeId
agentType
```

without changing assembled prompt behavior.

## Structured node

Verify ARCHITECT-style request still produces the same three-message structure.

## Tool-call node

Verify FE/BE-style request still produces the same context sections.

## Regression

Keep all existing assembler tests.

The new tests should not replace them.

---

# 19. Do Not Add Mocking Infrastructure Unless Necessary

The extracted assembler is intentionally easy to test without mocks.

For the new Context Engine entry point, prefer dependency injection only if required to test retrieval.

Do not introduce a large mocking framework or abstraction layer just to test Prisma.

If a clean unit seam is needed, keep it narrow.

For example:

```text
Context Engine
    ↓
retriever functions
```

can remain the current seam.

---

# 20. Observability

Do not introduce a large tracing system.

If useful, add minimal structured debug information around the boundary:

```text
context.requested
context.assembled
```

But only if existing runtime event conventions make this natural.

Do not persist new event types solely for this phase.

The existing RuntimeEvent system remains the source of truth.

---

# 21. Temporal Boundary

Do not modify Temporal orchestration in this phase unless the new Context Engine contract is required by an existing Temporal activity.

The Context Engine should remain orchestration-agnostic.

The intended relationship is:

```text
Temporal Activity
      ↓
Agent Runtime
      ↓
Context Engine
```

not:

```text
Temporal
   ↓
Context Engine
   ↓
Agent Runtime
```

Temporal decides when the node executes.

Context Engine decides what context that node receives.

---

# 22. Explicit Non-Goals

Do NOT implement:

- Context Engine V2
- generalized retrieval
- memory retrieval
- architectural memory
- project summaries
- code graph
- dependency graph
- Git retrieval
- execution-history retrieval
- ranking
- context importance scoring
- token budgeting
- summarization
- compaction
- prompt caching
- embedding-provider abstraction
- new vector database
- YAML configuration
- Agent Config redesign
- tool registry
- model router
- Temporal workflow redesign
- Inngest removal
- `buildContext()` deletion
- `inputArtifactContent` cleanup

If implementation pressure suggests one of these is required, stop and document the dependency instead of expanding scope.

---

# 23. Files Expected to Change

Likely:

```text
src/hcr/context-engine/types.ts
src/hcr/context-engine/index.ts
src/hcr/context-engine/assembler.ts
src/cognition/context-engine.ts
src/cognition/node-executor.ts
tests/hcr-context-engine.test.ts
```

Potentially:

```text
src/hcr/context-engine/engine.ts
```

if a dedicated implementation file makes the boundary clearer.

Avoid unrelated files.

---

# 24. Git Safety

Work only on:

```text
phase/hcr-context-engine
```

Do not modify:

```text
main
```

Do not modify unrelated Temporal or Agent Config work.

Keep the implementation in one focused commit.

Suggested commit:

```text
refactor(hcr): make context engine contract runtime-facing
```

Before committing:

```bash
bun test
bunx tsc --noEmit
```

If either fails:

1. identify whether the failure is pre-existing or introduced
2. do not hide it
3. do not broaden scope to fix unrelated failures
4. document it

---

# 25. Completion Criteria

This phase is complete when:

- `ContextRequest` is used by the actual runtime path
- `ContextResult` is returned by the Context Engine boundary
- Node Executor no longer needs to know individual Context Engine retrievers/assembler
- assembler remains pure
- existing behavior remains unchanged
- structured and tool-call paths both work
- existing regression tests remain
- new boundary tests pass
- TypeScript passes
- no new architectural subsystem has been introduced
- legacy compatibility seams remain intact

The final runtime shape should be:

```text
Node Executor
      │
      │ ContextRequest
      │ CallerContextInputs
      ▼
Context Engine
      │
      ├── retrieveArtifacts
      ├── retrieveRelevantFiles
      └── assembleContext
      │
      ▼
ContextResult
      │
      ▼
Node Executor
      │
      ▼
LLM / Tools
```

---

# 26. Final Principle

This phase is not about making the Context Engine smarter.

It is about making the Context Engine **real**.

After this phase, there should be exactly one explicit answer to:

> “How does an agent runtime ask Doable for the context it needs?”

The answer should be:

```text
ContextRequest
      ↓
Context Engine
      ↓
ContextResult
```

Everything more intelligent comes later.
