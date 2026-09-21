# Deferred Context Architecture — Intentionally Not Built Here

Each item names the future owner, why it waits, and what this task left
ready for it. Orthogonal parked items live in `d-2/hcr/HCR_KNOWN_CAVEATS.md`
(C1–C31) and are not repeated except where they intersect.

- **State reconstruction (§9).** Owner: future boundary. Waits for: execution
  introspection needs. Ready: `ContextRequest` already carries
  `projectId/executionId/nodeId`; retrievers are independently callable.
- **Generalized retrieval (§10).** Only artifact + vector-file sources are
  extracted (the ones that exist). Memory, events, git, dependencies,
  research sources: no fake providers created.
- **Context selection (§11).** Binary flags adopted as `ContextPolicy`;
  required/relevant/optional/deferred grading deferred until a consumer
  needs it.
- **Context budgeting (§12).** Budgets documented in `CONTEXT_MAP.md`
  (top-5, 700 chars, last-8, last-10); no token-budget system invented.
- **Graph retrieval.** No code/dependency graph; vector similarity unchanged.
- **Summaries / compaction.** Scratchpad truncation stays last-8; no
  summarizer introduced.
- **Architectural memory.** No memory-provider migration; `ProjectMemory`
  untouched.
- **`inputArtifactContent` removal.** Proven dead (Seam 1) but kept as an
  accepted-ignored parameter; delete only in an explicitly validated
  cleanup with `node-executor` call-site updates.
- **`buildContext()` wrapper.** ARCHITECT-pinned, sole caller dead
  `hcr-agent`; same separate-cleanup rule.
- **Caller-owned retrieval.** Files list, embeddings fetch, message
  fetch/reversal stay in `node-executor`; moving them behind the engine is
  a later task with its own parity proof.
- **AgentConfig wiring.** The loop still consumes `NodeConfig.systemPrompt`
  and registry limits; joining the `agent-config` boundary is documented
  future work, not this extraction.
- **Heartbeat/timeout posture.** Unchanged (C15/C16); long activities keep
  current policies until resilience tuning is scoped.
