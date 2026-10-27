# Deferred Context Architecture — Intentionally Not Built Here

> Status after D3 (Context Engine V2, 2026-10-27): selection grading,
> token budgeting, compaction, provenance, and the reproducibility fingerprint
> are implemented. The items below are still deliberately out of scope.

Each item names the future owner, why it waits, and what the engine left
ready for it. Orthogonal parked items live in
`d-2/hcr/HCR_KNOWN_CAVEATS.md` (C1–C31) and are not repeated except where
they intersect.

- **State reconstruction (§9).** Owner: D10/D11. Waits for: execution
  introspection and failure-drill needs. Ready: `ContextRequest` carries
  `projectId/executionId/nodeId`, and failures/verification are now retrievable
  sources.
- **Generalized retrieval (§10).** Artifacts, files, relevant files, messages,
  verification, failures, and project memory exist. Git history, dependency
  graphs, research providers, and events-as-context do not; no fake providers
  were created.
- **Context selection grading (§11).** Implemented as required / relevant /
  optional priorities with deterministic budget admission. A learned or
  per-agent scoring model is still out of scope.
- **Context budgeting (§12).** Implemented: token estimate, hard ceiling,
  required-source overflow reporting, and per-section omission counts.
- **Graph retrieval.** No code/dependency graph; vector similarity unchanged.
- **Summarization models.** Compaction is structural (pinning, truncation,
  omission notes), not model-generated summaries. A summarizer is a separate
  quality/verification decision.
- **Model-assisted memory extraction.** D4 persisted layered memory with
  deterministic curation. An LLM curator, USER-scoped product surface, and
  memory retrieval quality measurement are follow-ups.
- **Architectural memory.** No memory-provider migration.
- **`buildContext()` compatibility facade.** The old ARCHITECT-pinned wrapper
  is gone from the live path; only the single `buildContext` entry point
  remains.
- **AgentConfig wiring.** The loop consumes `NodeConfig.systemPrompt` and
  registry limits; joining agent configuration fully is future work.
- **Heartbeat/timeout posture.** Unchanged (C15/C16).
