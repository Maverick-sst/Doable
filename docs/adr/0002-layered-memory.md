# ADR 0002 — Layered memory with deterministic curation

**Status:** Accepted (2026-10-27)

## Context

D3 made memory a context source with provenance and budgets, but only the
single `ProjectMemory` row existed. Builds need durable, reusable knowledge
across runs without letting memory maintenance endanger execution.

## Decision

1. **Four persisted kinds** — episodic, semantic, procedural, preference.
   Working memory remains ephemeral (scratchpad/tool history) and is not
   stored as a memory row.
2. **One row per (owner, kind, subject, content hash)**. `contentKey` is a
   unique idempotency key, so replaying curation inserts nothing.
3. **Supersession over overwrite.** A newer entry for the same subject marks
   the previous one `SUPERSEDED` and links `supersededById`; history stays
   auditable.
4. **Conflict precedence.** User correction > newer curated content. A
   correction cannot be overwritten by curation.
5. **Deterministic curation.** Candidates are derived from project memory,
   verification reports, executions, and preference messages. No model call is
   required; model-assisted extraction can be added later without changing
   the storage contract.
6. **Failure isolation.** Curation runs as its own Temporal workflow after
   finalize/discovery. Callers treat start failure as best-effort.
7. **Retention and deletion.** Episodic entries expire (default 90 days).
   Deletion is soft, clears the embedding, and covers every version of a
   subject; derived caches must subscribe to the same deletion seam.
8. **Embeddings are optional.** Vector ranking is used when available; recent
   and confidence ordering keeps retrieval functional otherwise.

## Consequences

- Memory is auditable and replay-safe.
- Curation quality is bounded by deterministic extraction; richer extraction
  is a follow-up, not a blocker.
- Deletion propagation must be wired into D6 caches when they exist.
