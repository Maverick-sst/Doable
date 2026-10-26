# Doable — Next-Phase Implementation Plan

**Repository:** `https://github.com/Maverick-sst/Doable`
**Target:** Complete the local-first backend/runtime first; redesign the product UI after backend acceptance.
**Primary orchestration:** Temporal
**Canonical project files:** Local filesystem workspace
**Structured state:** PostgreSQL
**Research inputs:** REA analysis of the specific local Alan build, plus public Emergent and Alan product documentation.

## 1. Implementation sequence

Implement in the following order. Each phase should leave the application runnable and should end with the listed acceptance checks.

### Phase 0 — Baseline and architecture mapping
- Map the current execution paths, Temporal workflows/activities, background jobs, providers, tools, persistence and workspace operations.
- Inventory every Inngest reference and classify it as active, legacy, test-only or documentation.
- Record baseline test/build results and update the current-state documentation where it is stale.
- Map proposed contracts to existing modules before changing interfaces.

**Acceptance:** Current local golden path is reproducible; active execution paths and migration risks are documented; no existing user changes are lost.

### Phase 1 — Temporal durability and idempotency
- Make Temporal the only durable orchestrator for product execution and durable maintenance.
- Migrate or retire active Inngest consumers after their responsibilities are accounted for.
- Harden idempotency for run creation, artifact writes, file operations, runtime events and tool calls.
- Define cancellation, timeout, retryable/non-retryable errors, late activity completion and workflow-versioning behavior.
- Test duplicate triggers, worker restart during activity and cancellation during side effects.

**Acceptance:** Duplicate requests do not create duplicate active runs; worker restarts recover; cancellation remains terminal; retries do not duplicate unsafe side effects; failures leave an inspectable, recoverable state.

### Phase 2 — Agent configuration and cognitive runtime
- Add typed, versioned agent configurations for role, prompt, model policy, context policy, tools, output schema, limits and transitions.
- Store prompts as versioned files and validate configurations/schemas before execution.
- Centralize agent registration and selection.
- Standardize the reusable agent turn: policy → context assembly → model routing → output validation → tool authorization/execution → persistence/events → continue, ask, or finish.
- Persist session, turn and tool-call state needed for recovery.
- Keep current HCR node behavior compatible with the shared runtime.

**Acceptance:** All built-in agents validate; each run records the config version used; invalid config fails before execution; the loop is testable with fake model/tool adapters; model output cannot grant permissions or alter trusted identity.

### Phase 3 — Context Engine V2
- Extend the current assembler/retrievers behind stable contracts and preserve existing behavior with parity tests.
- Reconstruct context from conversation, current session state, requirements, plans, artifacts, workspace files, tool history, verification results, prior failures and curated memory.
- Implement conversation translation/recombination, source references, freshness/version metadata, retrieval ranking, deduplication, token budgeting and compaction.
- Preserve user intent, unresolved questions and pending approvals during compaction.
- Make context assembly reproducible after worker/process restart.

**Acceptance:** Existing fixtures retain expected behavior unless a change is documented; large conversations compact without losing required facts; stale/unavailable sources are visible; context does not blindly append the entire project history.

### Phase 4 — Layered memory and curation
- Define working, episodic, semantic, procedural and user/project preference memory.
- Store provenance, source references, confidence semantics, timestamps, scope, retention, supersession and deletion state.
- Implement retrieval, conflict resolution, user-correction precedence and deletion propagation to derived indexes/caches.
- Add a durable, bounded, idempotent memory-curation workflow.
- Keep memory failures independent from the core build path.

**Acceptance:** Every curated memory is traceable to sources; retries do not duplicate memories; conflicts follow a documented policy; deletion reaches canonical and derived stores; memory maintenance failure does not fail a build.

### Phase 5 — Model router and usage budgets
- Normalize provider adapters behind a common request/response/error contract.
- Declare capabilities per model and filter unsupported options before dispatch.
- Route using role/task, configured preferences, capabilities, availability, latency and cost/usage budgets.
- Add bounded retries, health checks/circuit breaking and explicit fallback rules.
- Persist provider/model, latency, error category and usage metadata; distinguish provider-reported usage from estimates.
- Enforce local-only mode: no silent remote fallback or egress.

**Acceptance:** Routing decisions are inspectable; unsupported capabilities are rejected before calls; local-only requests never reach remote providers; outages terminate with actionable bounded errors; secrets are never exposed in diagnostics.

### Phase 6 — Prompt caching and derived-state refresh
- Define application/provider cache layers, cache keys, scope, TTL, invalidation and source-version rules.
- Integrate provider-native cache metadata only where the provider supports it.
- Add durable refresh workflows only where retries/recovery justify them.
- Make refresh concurrency-safe and idempotent.

**Acceptance:** Cache failure affects performance, not correctness; source/config changes invalidate stale entries; keys are scoped by project/agent/config/version; telemetry records hit/miss/failure without recording prompt content.

### Phase 7 — Policy engine, tool registry and MCP
- Centralize allow/deny/approval decisions for tools, commands, paths, network access, provider egress and resource budgets.
- Define typed, versioned tool contracts: input/output schema, permissions, timeout, retry/idempotency, output limits and audit metadata.
- Move built-in tools behind a shared registry/dispatcher.
- Persist tool-call lifecycle and results.
- Add durable human approval using Temporal signals; bind approval to the exact action, arguments and relevant workspace revision.
- Add MCP as an adapter behind the same registry, dispatcher and policy—not as a separate permission system.

**Acceptance:** Every call passes schema and policy checks; trusted identity is server-injected; prompt wording cannot bypass denials; approvals authorize only the reviewed action; remote MCP use is explicit and opt-in.

### Phase 8 — Disposable sandbox and real verification
- Define a provider-neutral sandbox lifecycle: create, provision, sync a pinned workspace revision, execute, collect results, sync approved changes, destroy.
- Use real isolation with non-root execution, resource/time/output limits, process-tree termination, network default-deny, no host-home/root mounts and no ambient secrets.
- Harden path traversal, symlink handling, archive extraction and read/write/delete/export operations.
- Keep the local workspace canonical; detect revision conflicts before syncing changes back.
- Run project-appropriate dependency/lockfile checks, lint, typecheck, tests, build and smoke tests where configured/detected.
- Persist verification reports containing command, sandbox ID, workspace revision/hash, exit code, duration, bounded logs and status.

**Acceptance:** Generated code does not execute unrestricted on the host; destroying a sandbox loses no canonical project data; sync-back cannot silently overwrite newer files; timeouts kill child processes; verification reports correspond to actual command outcomes. Distinguish `passed`, `failed`, `skipped`, `blocked` and `infrastructure_error`.

### Phase 9 — Verification-driven repair
- Feed exact verification failures and bounded logs into context.
- Generate a scoped repair plan and diff; apply changes through the same tool/workspace policy.
- Rerun failed checks and retain each attempt's diff, revision and report.
- Bound attempts, wall-clock time, tokens and tool usage; detect repeated failure and escalate to the user.

**Acceptance:** Repair stops on success, exhausted budget or repeated failure; only a final workspace revision that passes required checks is marked verified; user changes are preserved; unsuccessful repair returns evidence and next actions.

### Phase 10 — Background work and observability
- Add durable workflows where justified for memory curation, project summaries, semantic index refresh, cache refresh, reconciliation and cleanup.
- Extend the existing runtime event ledger with workflow/node/agent/provider/context/memory/tool/sandbox/verification/retry/cancel/budget events.
- Add structured redacted logs, per-run timelines, provider/tool latency and usage, verification history, readiness checks and diagnostics export.
- Avoid maintaining a second competing event stream without an explicit reason.

**Acceptance:** Maintenance survives worker restart and is idempotent; its failure cannot corrupt primary state; a user can inspect why a run succeeded, failed, retried, waited for approval or stopped; diagnostics omit secrets and raw prompts by default.

### Phase 11 — Backend end-to-end hardening
- Validate clean local setup and documented startup.
- Run mock-provider tests and real-provider smoke tests separately.
- Exercise worker restart, duplicate trigger, cancellation, provider outage, sandbox loss, cache failure, memory-curation failure, file conflict, export and deletion.
- Fix or document every acceptance failure with severity and impact.

**Acceptance:** The complete local golden path works from a clean setup; failure drills produce correct terminal states; mock and real-provider evidence are distinguished; backend contracts are stable for UI work.

## 2. Target backend contracts

### 2.1 Durable run lifecycle
Every run should have a stable ID, project/session association, workflow/config version, lifecycle state, timestamps, cancellation state, budget counters and terminal result. State transitions must be validated. Duplicate submissions should return or attach to the existing run where appropriate.

### 2.2 Agent configuration
A configuration should define:
- stable agent ID and version;
- role and task scope;
- prompt reference/version;
- accepted input and output schemas;
- model/capability preferences and budget;
- context sources and budget;
- allowed tools and policy profile;
- timeout/retry behavior;
- transition/termination rules.

Configuration and prompt versions used by a run must remain inspectable after later edits.

### 2.3 Context assembly
Context should be assembled from typed sources with source IDs, revisions/timestamps, relevance, freshness and truncation status. Include only information useful for the current step. Keep retrieval and assembly independently testable.

### 2.4 Memory record
Each memory record should include:
- ID, type and project/user scope;
- content or structured payload;
- source references and provenance;
- confidence with documented semantics;
- created/updated/last-used timestamps;
- lifecycle/retention state;
- supersession/conflict links;
- version and deletion state.

### 2.5 Model request and routing result
Record requested task/role, selected provider/model, capability match, routing reason, egress classification, timeout/retry policy, usage/budget state and outcome. Do not store credentials or log full sensitive payloads.

### 2.6 Tool invocation
Every tool call should have a stable ID, tool/version, validated arguments, actor/run context, policy decision, approval reference if required, idempotency key, start/end time, status, bounded result/error and audit events.

### 2.7 Verification report
A report should be linked to an immutable workspace revision/hash and include each check's command, status, exit code, duration, bounded output and skip/failure reason. Verification must not be inferred from file presence.

## 3. Security and local-first requirements
- Local storage is the default for projects, conversations, files, artifacts, memory and run history.
- Provider egress is visible and controlled by configuration; local-only mode is enforced server-side.
- Treat repository files, model output, tool output and MCP content as untrusted input.
- Validate tool schemas and permissions before execution.
- Restrict filesystem operations to the project workspace; test symlinked parents/files and read/write/delete/export paths.
- Sandbox execution is isolated, non-root, resource-bounded and network-denied by default.
- Never inject host credentials or environment secrets into generated-code execution.
- Redact credentials, auth headers, database URLs, private payloads and raw prompts from logs.
- Make export and deletion behavior explicit and testable.

## 4. Alan analysis using REA

Analyze the exact local Alan build, not an assumed product version.

1. Record app version/build, platform, installation/package format and analysis tool version.
2. Inventory package metadata and relevant files read-only.
3. Select REA's supported analyzer based on observed app technology (for example, Electron/JavaScript where applicable).
4. Capture observable UI flows and authorized runtime evidence.
5. Record evidence IDs/paths, limitations and reproducible steps.
6. Build a capability matrix and map each useful capability to a Doable implementation gap and acceptance test.

Use these labels:
- **Observed:** directly reproduced or visible in an artifact/runtime.
- **Documented:** stated by an official public source.
- **Inferred:** plausible but unconfirmed.
- **Unknown:** not established by evidence.

For each finding, record the claim, label, source/evidence ID, version/date, confidence, limitations, Doable equivalent, implementation recommendation and test. Do not present inferred internals as fact. The goal is to implement equivalent useful capabilities, not copy proprietary code, private prompts, confidential internals or brand assets.

### Research starting points
- REA skill: https://github.com/morluto/rea/blob/main/.agents/skills/reverse-engineer-anything/SKILL.md
- Emergent workspace tour: https://help.emergent.sh/a-tour-of-the-workspace
- Emergent FAQ: https://help.emergent.sh/faqs
- What is Emergent?: https://help.emergent.sh/what-is-emergent
- Alan: https://tryalan.ai/
- Alan local execution docs: https://docs.tryalan.ai/docs/cloud-and-local/local-execution

Treat public documentation as product-level evidence, not proof of internal architecture. Confirm whether the local Alan desktop build is the same product/version covered by current public docs.

## 5. UI implementation — after backend acceptance

Build a cohesive, dark-first interface inspired by the clarity and workflow patterns of Emergent, using Doable's own visual identity and implementation.

### Required screens
- Welcome / create or open project
- Dashboard / recent projects and runs
- Project workspace with conversation, build activity, preview/output and files
- Run detail with chronological workflow/node/agent/tool timeline
- Artifact and verification report viewer
- File/code inspection and export
- Provider/model configuration and egress status
- Tool/MCP management and permissions
- Memory/context inspection and deletion
- Settings, diagnostics and local runtime health

### Interaction requirements
- All controls reflect real backend state and invoke working actions.
- Show streaming/thinking/tool execution/approval/waiting/retry/failure/completion states distinctly.
- Provide cancellation, retry, inspect, approve/deny, export and error recovery where supported.
- Include useful loading, empty, offline, error and partial-result states.
- Keep the workspace navigable on smaller screens and support keyboard/accessibility basics.
- Do not use fake progress, placeholder success or nonfunctional buttons.

### Visual direction
- Charcoal/near-black foundation, restrained neutral surfaces, one muted accent, clear typography and generous but efficient spacing.
- Strong hierarchy between conversation, run activity, preview and project files.
- Subtle motion only when it improves state comprehension.
- Avoid visual clutter, excessive gradients, ornamental dashboards and imitation of proprietary assets.

**UI acceptance:** The core project lifecycle is usable end-to-end through the UI; every displayed state comes from backend data; run history and verification evidence are inspectable; error and approval states are actionable.

## 6. Local application and optional landing page
- Keep the main product runnable locally with a documented setup/start/stop/reset path.
- Provide health/readiness diagnostics for the application, database and Temporal worker.
- Ensure user data and project files persist across restarts.
- Consider desktop packaging only after local browser workflows are stable.
- A simple public landing page may be deployed on Vercel, but it must remain independent of the local runtime and must not make a hosted backend a prerequisite.

## 7. Test plan

### Unit tests
- Agent configuration/schema validation
- Context ranking, budgeting, compaction and provenance
- Memory conflict, supersession, deduplication and deletion
- Model capability filtering, routing, fallback and budgets
- Policy decisions, approval binding and tool argument validation
- Path traversal, symlink protection and archive safety
- Verification status mapping and repair-budget enforcement
- Idempotency keys and state transitions

### Integration tests
- Temporal workflow/activity retries and worker restart
- Persistence of sessions, runs, events, artifacts and reports
- Provider adapters with mock and real smoke tests
- Tool dispatcher and MCP policy enforcement
- Sandbox lifecycle, command execution, timeout and cleanup
- Workspace sync conflict handling
- Memory/cache/index background workflow recovery

### Golden path
1. Start Doable locally from documented instructions.
2. Create a project and complete discovery.
3. Produce and approve the requirements artifact.
4. Run the HCR build through Temporal.
5. Inspect run timeline, artifacts, files and tool results.
6. Execute real configured verification commands in the sandbox.
7. Trigger a controlled failure and complete a bounded repair attempt.
8. Restart the worker and confirm durable recovery.
9. Export the project and verify the archive.
10. Delete project/memory data and verify deletion propagation.

### Failure drills
- Duplicate run request
- Worker restart mid-activity
- Cancellation during a tool side effect
- Provider timeout/outage
- Local-only mode with remote provider unavailable
- Sandbox timeout/destruction
- Workspace revision conflict
- Cache and memory-maintenance failure
- Malformed model output/tool arguments
- Unsafe path/symlink/archive input
- Repair budget exhaustion

## 8. Definition of done

### Runtime and durability
- Temporal is the sole durable orchestrator.
- Retries, cancellation, duplicate requests and worker restart are handled deterministically.
- Run state, events and artifacts remain inspectable.

### Cognition, context and memory
- Agents are versioned/configurable.
- Context is reconstructed from relevant typed sources and can be compacted safely.
- Memories have provenance, conflict/lifecycle handling and deletion propagation.

### Models and tools
- Routing respects model capabilities, budgets and egress policy.
- Tool execution passes through typed contracts and centralized policy.
- Human approvals are durable and bound to the exact action.

### Sandbox and verification
- Generated commands run in real isolation with bounded resources.
- Verification reports refer to actual commands and a specific workspace revision.
- Repair is bounded and cannot mark an unverified revision as verified.

### Product
- Local setup, project creation, build, inspect, verify, repair and export are usable end-to-end.
- The UI accurately represents real state and offers actionable failure recovery.
- Local-first privacy and data ownership are clear.

### Release quality
- Typecheck, lint, tests, production build and migrations pass.
- Clean setup and golden-path results are documented with actual command output.
- Remaining limitations are explicit and prioritized.

## 9. Implementation handoff output

At the end of each phase, report:
1. phase completed and scope;
2. changed files and important design decisions;
3. tests/commands actually run and results;
4. any behavior not verified;
5. unresolved risks or blockers;
6. next phase and prerequisites.

Do not report a phase complete while its acceptance checks are failing or untested.
