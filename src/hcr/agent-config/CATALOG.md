# HCR Agent Catalog (§5D record)

Source of truth for extraction: `AGENT_REGISTRY` (`src/cognition/agent-registry.ts`)
plus the prompt modules it references. Wording below mirrors the registry;
prompts are imported by reference in `definitions.ts`, never copied.

## Per-agent record

| agentId / agentType | Node | Prompt source | Output expectation | Context expectation | Tool expectation |
|---|---|---|---|---|---|
| `architect` / `ARCHITECT` | `ARCHITECT` | `ARCHITECT_SYSTEM_PROMPT` | `ARCHITECTURE_SPEC` JSON | latest `DISCOVERY_REQUIREMENT`, no files/history | none |
| `researcher` / `RESEARCHER` | `RESEARCH` | `RESEARCHER_SYSTEM_PROMPT` | `RESEARCH_DOSSIER` JSON | latest `ARCHITECTURE_SPEC`, no files/history | none |
| `prd-reviewer` / `PRD_REVIEWER` | `PRD_REVIEWER` | `PRD_REVIEWER_SYSTEM_PROMPT` | `APPROVED_PRD` JSON | latest `RESEARCH_DOSSIER`, no files/history | none |
| `staff-engineer` / `STAFF_ENGINEER` | `PLANNER` | `STAFF_ENGINEER_SYSTEM_PROMPT` | `EXECUTION_PLAN` JSON | latest `APPROVED_PRD`, no files/history | none |
| `frontend-eng` / `FRONTEND_ENG` | `FRONTEND_ENG` | `FRONTEND_ENGINEER_SYSTEM_PROMPT` | file mutations, no artifact | `EXECUTION_PLAN` + file tree + vector top-5 + last-10 BUILD messages | full file tools, ≤20 iterations |
| `backend-eng` / `BACKEND_ENG` | `BACKEND_ENG` | `BACKEND_ENGINEER_SYSTEM_PROMPT` | file mutations, no artifact | same as frontend | full file tools, ≤20 iterations |

The `PLANNER` → `STAFF_ENGINEER` row is the one non-identity node→agent
mapping (§5B). It is preserved in `resolver.ts`, not renamed.

## Ownership split (§5C)

`AgentConfig` owns identity/role, instructions, capabilities, and policy
references. It does NOT own `contextConfig` (future Context Engine),
`outputArtifactType` / `consumedArtifactTypes` / `outputMode` (HCR
output/artifact contract — stays with the orchestration layer), or any
execution identity.

## Prompt-cache behavior (observed, preserved)

Today `buildNodeContext` emits the node system prompt as the first message
(stable prefix) and all dynamic material (artifacts, files, history,
scratchpad, user prompt) in later messages. This boundary keeps that shape:
`instructions` is one stable, serializable field with no dynamic values, and
tool catalogs are referenced by name only — so a future cache-aware context
builder can keep treating the prefix as cacheable. No cache algorithm is
claimed here.

## Tool-loading posture (§6.4)

`toolPolicy.eligibleTools` declares names; nothing here imports `lib/tools.ts`
or any tool implementation. The future discovery system resolves these names
to a small loaded set per execution.

## Model-router boundary (§7)

`modelPolicy` carries `{ taskProfile, allowFallback }` hints only. Provider
selection, invocation, fallback execution, health, and cost live in the Model
Router (`src/providers`, D5). This boundary never reads model env or calls a
provider.

## Session/context boundary (§10)

No conversation, tool history, memory, artifacts, or runtime state in
`AgentConfig`. Session policy/capability requirements may be added as future
static fields; history itself belongs to the Session/Context system.
