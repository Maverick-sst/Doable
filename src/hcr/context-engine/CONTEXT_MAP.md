# HCR Context Map — Inventory (Agent 02, Phase A)

Code-level map of every context source flowing into `buildNodeContext`
(`src/cognition/context-engine.ts`). Behavior-preserving reference for the
extraction; nothing here changes runtime behavior.

Message ordering contract (must survive extraction verbatim):

```text
[system(nodeConfig.systemPrompt),
 user(artifacts + CURRENT TASK + file tree + relevant files + scratchpad),
 ...historyMessages,
 ...toolMessages,
 user(prompt)]
```

Budget constants (§12): vector top-5 · 700-char file truncation ·
scratchpad last-8 · message fetch last-10 (caller side).

## Source table

| Source | Current owner | Storage | Retrieval method | Transformation | Consumers |
|---|---|---|---|---|---|
| Consumed artifacts | engine (`context-engine.ts:29-44`) | `Artifact` rows | `findFirst({projectId, type} order version desc)` per `contextConfig.consumedArtifactTypes` | `=== PROJECT <TYPE> (Version <v>) ===` + pretty JSON | all structured nodes via `node-executor` |
| Explicit input artifact | `node-executor.ts:68-85` resolves; engine **ignores** (see Seam 1) | `Artifact` row by id, else latest of first consumed type | `findUnique` / `findFirst` | none (passed through, unread) | `buildNodeContext` input (dead) |
| File list | caller (`node-executor.ts`, FE/BE branch only) | `Project.files` select | `findUnique(project)+include.files` per execution | paths joined, or `"No files yet!"` | file-tree section (FE/BE only) |
| Semantic files | engine (`context-engine.ts:57-73`) | `File.embedding` pgvector | raw SQL `embedding <=> promptEmbedding LIMIT 5`, `EMBEDDING_SUCCESSFUL` only | `[path]` + 700-char slice + `...` | relevant-files section (FE/BE only) |
| Prompt embedding | caller (`node-executor`, both branches) | OpenRouter `nvidia/...-embed` 768-d | `getEmbeddings(prompt)` once per node run | `[v0,v1,…]` vector string | vector query input (unused when disabled) |
| Message history | caller (`node-executor`, FE/BE: last-10 BUILD desc→reversed) | `Message` rows | `findMany({projectId, phase:BUILD})` | roles lowercased → `LLmMessage` | history slot (all registry configs disable it) |
| Scratchpad | caller (`node-executor` tool loop) | ephemeral `{currentTask, iteration, scratchpad[]}` | in-memory | last-8 joined, `tool_calls` mode only | scratchpad section (FE/BE only) |
| Tool history | caller (`node-executor` tool loop) | ephemeral array | in-memory | assistant+tool_calls / tool+id / fallback assistant text | tool messages (FE/BE only) |
| Current task | caller (`currentContext.currentTask \|\| prompt`) | ephemeral | in-memory | `CURRENT TASK` header | user blob (all nodes) |
| Original prompt | workflow input → route → event → activity | `Message.content` / event payload | threaded unchanged | final `user(prompt)` message | all nodes |
| System prompt | `AGENT_REGISTRY` → `agent-config` mirror | prompt modules | static import | first `system` message | all nodes |

## Seams (brief §5, with file:line evidence)

**Seam 1 — `inputArtifactContent` is dead (§5.1).** Accepted at
`context-engine.ts:6-25`, never destructured (line 27) or read. Resolution
work in `node-executor.ts:68-85` has no downstream effect; the engine always
re-queries by `contextConfig.consumedArtifactTypes`. Locked by regression
test; removal is a separate cleanup step.

**Seam 2 — `buildContext()` compat wrapper (§5.2).** Pins
`AGENT_REGISTRY[ARCHITECT]` via `require()` interop (`context-engine.ts:126-158`).
Sole caller is the dead `hcr-agent.ts` (`chat/requested`, no sender). Kept
untouched; removal only in an explicitly validated cleanup.

**Seam 3 — Retrieval outside the engine (§5.3).** Files list, prompt
embedding, and message fetch/reversal live in `node-executor` (both
branches fetch embeddings; structured nodes pass `files:[]`,
`messages:[]`). First extraction keeps caller-owned retrieval as-is; only
engine-internal queries (artifacts, vector files) move behind retrievers.

## Notes for extraction

- Structured nodes (ARCHITECT/RESEARCH/PRD_REVIEWER/PLANNER) exercise only:
  artifacts + current task + prompt + system prompt. All other sections
  render empty/off for them — tests must cover both modes.
- `includeMessageHistory` is false in every registry entry: history code is
  preserved but dormant; do not enable globally.
- `getEmbeddings` runs even when vector search is disabled (waste, parked —
  not this task's to fix).

## Post-completion ownership (Agent 04)

Live flow: `node-executor → engine.buildContext → retrievers →
assembleContext → ContextResult`. Against the table above:

- Explicit input artifact: resolution deleted from `node-executor`; the
  unread pass-through is gone (Seam 1 removed, not merely locked).
- File list: `retrievers/files.ts`, gated by `includeFileTree`.
- Message history: `retrievers/message-history.ts`, gated by
  `includeMessageHistory` (still false everywhere — dormant preserved).
- Semantic files, consumed artifacts: unchanged retrievers.
- Task: engine resolves `request.task || request.prompt`; assembler renders
  the resolved value verbatim.
- Embeddings: still caller-generated, still passed through (kept outside
  per boundary rule); still fetched even when vector search is off (waste
  stands, parked).
- `buildNodeContext` is a signature-stable facade with no live callers;
  `buildContext()` wrapper kept for the dead `hcr-agent` path only.

## V2 — provenance, ranking, budget, compaction (2026-10-27)

V2 keeps the same public entry point (`buildContext`) and the same message
ordering, but the engine now returns provenance and applies a deterministic
selection pass between retrieval and assembly.

```text
ContextRequest (+ optional budget)
      │
      ▼
Policy-gated retrieval
  artifacts · files · relevant files · messages
  verification · failures · memory      (opt-in flags)
      │
      ▼
Conversation facts (intent, unresolved questions, pending approvals)
      │
      ▼
selectContext  — dedup · rank · token budget · compaction
      │
      ▼
assembleContext (pure) + sources · notes · facts
      │
      ▼
ContextResult { messages, sources, facts, budget, fingerprint }
```

**Source manifest.** Every considered source produces a
`ContextSourceReference` with kind, id, label (path/type/message id), version
or `updatedAt`, status (`available`/`stale`/`missing`), priority, inclusion,
and a drop reason. Content never enters the manifest.

**Ranking and budget.** Required sources are charged first and never
truncated: system prompt, task, prompt, consumed artifacts, and pinned facts.
Relevant sources follow in operational order (verification, failures, memory,
relevant files, file tree); optional sources are newest-first (tool history,
message history, scratchpad). The default ceiling is
`CONTEXT_TOKEN_BUDGET=60000` estimated tokens (4 chars/token); the node
executor passes it on every request.

**Compaction.** Over-budget sources are dropped with an explicit
`=== CONTEXT NOTES ===` entry. Message compaction keeps intent, unresolved
questions, and pending approvals as required facts, then keeps the newest
messages that fit. Tool history is trimmed newest-first and orphan tool
results are pruned when their assistant call was dropped. The file tree is
capped at 200 paths with a remainder line.

**Reproducibility.** Retrieval has deterministic tie-breaks
(`createdAt, id`), selection is pure, and `fingerprintContext` hashes only
stable fields. The node executor records `context.assembled` with the
fingerprint, budget report, and source references, so two workers assembling
the same durable state produce the same fingerprint.

**New opt-in policy flags** (default false, so existing node contracts are
unchanged): `includeVerification`, `includeFailures`, `includeMemory`,
`maxHistoryMessages`.
