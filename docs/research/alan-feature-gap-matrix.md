# Alan → Doable Capability Matrix

Target artifact: `/home/maverick/alanai/Alan-0.3.113-amd64.deb`
SHA-256: `c4fa8fa7cd4a46c331b5197c43154e36a3077ac001cc4a35a5fdcf6cf38a30a3`
Analysed: 2026-10-26, read-only

## Method and limits

- Package metadata and member inventory read with `dpkg-deb` (no install, no
  execution of the app).
- `app.asar` header parsed directly to enumerate module structure. No code from
  the bundle was executed.
- The REA MCP server is not registered in this environment. Per the
  maintainer's instruction to prefer a pinned, reviewed tool over
  `npx -y rea-agents@latest`, REA was not executed against the artifact here.
  The correct REA route for this target is `analyze_javascript_application`
  against `app.asar`; that run is pending in Delivery D0 and its output must
  stay outside the repository.
- Public product documentation was not consulted for this first pass; the
  matrix below is artifact-derived. Documentation comparison is a pending D0
  task.

Labels: **Observed** (reproduced in the artifact), **Documented** (official
public source), **Inferred** (plausible, unconfirmed), **Unknown**.

## Artifact facts

| Claim | Label | Evidence |
|---|---|---|
| Package `alan` version 0.3.113, amd64, Vendor Supatest | Observed | `dpkg-deb -I` |
| Homepage `https://tryalan.ai` | Observed | control file |
| Auto-update from `tryalan-ai/alan-releases` via GitHub provider | Observed | `resources/app-update.yml` |
| Electron application | Observed | `chrome-sandbox`, `resources.pak`, `locales/`, `LICENSE.electron.txt` |
| App main process bundle `out/main/index.js` (719 KB) | Observed | asar header |
| Renderer is Vite/React with hashed chunk assets | Observed | `out/renderer/assets/*` |
| 1,944 asar entries: 111 directories, 1,833 files | Observed | asar header parse |
| Bundles an `opencode` engine binary (186 MB ELF) at `resources/engine/` | Observed | package listing |
| Bundles `alan-agent.cjs`, `alan-holder.cjs`, `alan-lease.cjs`, `claude-sdk.mjs` | Observed | `resources/alan-runtime/` |
| Ships `node-pty` unpacked | Observed | `app.asar.unpacked/node_modules/node-pty` |
| Uses `@workos-inc/node` | Observed | `node_modules/@workos-inc/node` |
| Ships an AppArmor profile with `userns` | Observed | `resources/apparmor-profile` |

## Capability matrix

| # | Capability | Label | Alan evidence | Doable equivalent | Gap | Doable recommendation |
|---|---|---|---|---|---|---|
| 1 | Artifact viewer as a first-class product surface | Observed | `ArtifactViewer` (1,536 KB) | `components/project-workspace.tsx` artifact tab | **Partial** | Doable has an inspector but no artifact-centric navigation or large-artifact handling. Improve in D12; add artifact-level pagination/virtualisation first |
| 2 | Artifact pipeline / list panel | Observed | `ArtifactListPanel` | Artifacts API + list | Partial | Doable lacks pipeline-stage grouping; add in D12 |
| 3 | Real embedded terminals | Observed | `TerminalInstance`, `TaskTerminalPanel`, `GlobalTerminalPanel`, `node-pty` | None | **Missing** | Doable's sandbox (D8) can host a terminal; defer the UI to D12 |
| 4 | Skills with code/file browsing | Observed | `SkillCodeViewer`, `SkillFileTree` | Agent registry + prompt files | **Missing** | Doable has versioned prompts (D2) but no browsable skill surface. Add a config/prompt browser in D12 |
| 5 | Context graph visualisation | Observed | `ContextGraphSection` | Context Engine (D3) | **Missing** | Build the data model in D3, visualise in D12 |
| 6 | Whiteboard / visual canvas | Observed | `WhiteboardEditor`, `WhiteboardPickerMenu` | None | Missing | Explicitly out of Doable scope; not a product gap |
| 7 | Cloud vs local environment split | Observed | `CloudSettingsPage`, `CloudEnvironmentSessionPage`, `CloudAccessStatusNotice`, `RuntimeComputersSection` | `AUTH_MODE=local` / `hosted`, `DATABASE_DRIVER` | **Partial** | Doable has the config split; it needs a visible egress/environment status surface (D5 + D12) |
| 8 | Sandbox network policy | Observed | `SandboxVpnProfileDialog` | None | **Missing** | D8 sandbox must define network policy; the dialog is a D12 surface |
| 9 | Remote runtime devices | Observed | `RuntimeDeviceAuthorizationPage`, `HarnessDeviceAuthorizationPage` | None | Out of scope | Doable is local-first; skip |
| 10 | Agent and model selection UI | Observed | `AgentSelectionMenuContent`, `ModelVendorMark`, `LiteAgentSection` | `app/settings/page.tsx` (readiness only) | **Partial** | D5 model router should expose a real selection surface in D12 |
| 11 | Agent pool / capacity | Observed | `CodexPoolPanel` | None | Missing | Consider in D10/D11 for concurrent-run limits |
| 12 | SCM / pull-request integration | Observed | `PullRequestDetailPage`, `PullRequestState`, `GitHubBranchSelect`, `ScmConnectionImpactDialog` | None | Out of scope for local-first V1 | Defer past D12 |
| 13 | Task planning surface (cycles, epics) | Observed | `CyclesSection`, `EpicsSection`, `TeamCyclesPage`, `TeamEpicDetailPage` | `EXECUTION_PLAN` artifact + task graph | **Partial** | Doable has the plan artifact; it needs a task-graph view in D12 |
| 14 | Command palette + shortcut legend | Observed | `CommandPalette`, `KeyboardShortcutLegend` | None | Missing | Cheap D12 win for workspace navigation |
| 15 | Feature gating | Observed | `GatedFeatureToggle`, `UpgradeRequiredState` | None | Missing | Optional; useful once hosted mode exists |
| 16 | Reporting and analytics | Observed | `ReportsPage`, `NewReportDialog`, `AnalyticsDashboardGate`, `KpiCard` | Runtime event ledger | **Partial** | D10 observability produces the data; D12 renders it |
| 17 | Notifications and inbox | Observed | `NotificationsPage`, `InboxPanel` | None | Missing | D10 can emit durable notification events |
| 18 | Onboarding | Observed | `OnboardingPage` | Landing page | **Partial** | Doable needs a first-run wizard (D12) that also provisions the local stack |
| 19 | Plugin management | Observed | `PluginsSettingsPages` | Tool registry (D7) | **Missing** | D7 tool registry + MCP adapter is the equivalent substrate; surface in D12 |
| 20 | Document/editor surface | Observed | `DocumentEditorContent`, `GlobalCreateDocumentProvider` | File viewer/editor | **Partial** | Doable's file editor is a textarea; a real editor is a D12 upgrade |
| 21 | Chat-to-task conversion | Observed | `ConvertChatToTaskDialog`, `CreateChatTaskDialog` | Discovery → approval → build | **Partial** | Doable's discovery conversation already acts as the conversion point; needs UI clarity in D12 |
| 22 | Team/org model | Observed | `OrganisationPage`, `CreateTeamDialog`, `MembersSection`, `TeamSocketProvider` | Single local user | Out of scope | Local-first product; do not chase |
| 23 | Integrations (Slack, etc.) | Observed | `SlackConnectCallback`, `IntegrationsSettingsPage` | None | Out of scope | Skip; MCP (D7) is the extension seam |
| 24 | Open/embeddable UI blocks | Observed | `OpenUIBlock` | None | Missing | Only relevant if Doable ever embeds elsewhere |
| 25 | Context/agent token and cost surfaces | Inferred | `ModelVendorMark`, usage-adjacent modules | `model.usage` runtime events (D1) | **Partial** | The event ledger is the substrate; D5 adds budgets and D12 renders spend |
| 26 | Idempotent, resumable long runs | Unknown | Not established from static evidence | Attempt/resume model (D1) | n/a | Doable's D1 design is arguably ahead here; verify against Alan's runtime behaviour later |
| 27 | Agent lease/holder protocol | Observed | `alan-lease.cjs`, `alan-holder.cjs` | None | Unknown | Possibly a concurrency-lease mechanism; investigate in D0 via REA before drawing conclusions |
| 28 | Provider/agent invocation protocol | Observed | `alan-agent.cjs` (3.2 MB) bundles the Claude Agent SDK | `src/providers` (D5) | **Partial** | D5 router should be comparable in capability: tool policy, budget, approval before invocation |

## Highest-value gaps for Doable

1. **Long-run resumability and idempotency (D1).** Alan's `alan-lease` and
   `alan-holder` modules suggest a lease/holder pattern for agent execution
   (D0 to confirm). Doable's resume model should be reviewed against it.
2. **Provider/agent invocation protocol (D5).** Alan bundles a full agent SDK
   (3.2 MB) plus a separate lease module. Doable's agent turn (D2) and router
   (D5) should reach comparable explicitness: policy, budget, approval, usage.
3. **Artifact-centric navigation (D12).** Alan treats artifacts as a primary
   product surface; Doable treats them as a tab. Cheap structural win.
4. **Visible egress and environment status (D5 + D12).** Alan has explicit
   cloud-access notices. Doable's remote-provider mode needs the same
   visibility, especially now that RunAnywhere is configured.
5. **Bounded verification and repair (D8, D9).** Not visible in the static
   evidence for Alan; Doable's spec is more demanding here. Keep Doable's
   stricter "never claim verified without a real command" rule.

## Pending D0 research

- Run REA `analyze_javascript_application` on the extracted asar with a pinned
  REA version; keep raw output outside the repository.
- Inspect `alan-lease.cjs` and `alan-holder.cjs` for the lease/holder
  protocol, and `alan-agent.cjs` for the invocation/approval contract.
- Read the Emergent workspace tour, Emergent FAQ, Alan product pages, and Alan
  local-execution docs; label Documented vs Observed; confirm whether the
  local 0.3.113 build matches current public documentation.
- Record reproduction steps and evidence IDs for every row above.
