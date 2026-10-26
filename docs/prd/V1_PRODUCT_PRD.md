# Doable V1 Product PRD

## Goal

A local-first browser workspace that takes a user from an idea to an inspectable,
editable, exportable project, with human approval before expensive work.

## Primary journey

1. Open the local app.
2. Create a named project and choose a domain.
3. Complete discovery through a focused conversation.
4. Review the versioned `DISCOVERY_REQUIREMENT` artifact.
5. Approve and start the build.
6. Watch the six-node Temporal graph and inspect artifacts/files.
7. Export the workspace as a ZIP.
8. Iterate or retry without losing history.

## Screens

### Dashboard

- Project list with real names, descriptions, status, updated time, and failure
  reason.
- Create form: name, description, domain.
- Open/delete actions.

### Project workspace

- **Discovery:** message history, prompt composer, requirements artifact
  preview, approval gate.
- **Build:** start/retry/cancel controls, node timeline, execution IDs, recent
  events, build artifacts.
- **Artifacts:** list and JSON inspector with type, revision, schema version,
  validation status, and content hash.
- **Files:** workspace tree, viewer/editor, create/delete, export.

### Settings

- Postgres/Temporal readiness.
- Auth mode and provider identity.
- Workspace root.
- Local vs remote model configuration guidance.

## API contract

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/projects` | List/create projects |
| GET/PATCH/DELETE | `/api/projects/:id` | Project detail/update/delete |
| POST | `/api/projects/:id/discovery` | Discovery turn |
| POST | `/api/projects/:id/chat` | Start/iterate build through Temporal |
| POST | `/api/projects/:id/retry` | New attempt for a failed run |
| POST | `/api/projects/:id/cancel` | Cancel active build |
| GET | `/api/projects/:id/status` | Project/build status |
| GET | `/api/projects/:id/hcr` | Latest build graph/events/artifacts |
| GET | `/api/projects/:id/artifacts` | All artifacts |
| GET/POST | `/api/projects/:id/files` | List/create files |
| GET/PATCH/DELETE | `/api/projects/:id/files/:fileId` | File detail/update/delete |
| GET/POST | `/api/projects/:id/verifications` | Structural verification report |
| GET | `/api/projects/:id/export` | ZIP export |
| GET | `/api/health` | Service readiness |

All project-scoped routes require the local profile (or hosted user) and verify
project ownership.

## Acceptance criteria

- A named project can be created.
- Discovery produces a validated `DISCOVERY_REQUIREMENT`.
- A build cannot start without an approved requirement.
- The build runs only through Temporal.
- The UI shows project, node, execution, failure, and artifact state.
- Files are persisted in the workspace and survive restart.
- A failed build can be retried without a manual DB edit.
- An active build can be cancelled.
- ZIP export works with no dependency on Temporal.
- Local services bind to loopback.
- No Inngest runtime path remains.
- Typecheck, unit tests, lint, and build pass.

## Out of scope for V1

- Automated deployment to third-party hosting.
- Multi-tenant teams/billing.
- Native desktop packaging.
- Guaranteed repair of generated code (verification and bounded repair are
  staged after the V1 golden path).
- Real-time streaming of model tokens (polling is acceptable).

## Success signals

- First project reaches an exported ZIP with no manual DB edits.
- A failed run is recovered through the UI.
- Artifacts and files remain inspectable after restart.
- No prompt/model content appears in logs.