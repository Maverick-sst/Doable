# Doable Glossary

Domain terms used by the product, docs, and architecture review.

- **Project** — the durable container for one user intent, its messages,
  workflows, artifacts, files, and verifications.
- **Discovery Requirement** — the validated `DISCOVERY_REQUIREMENT` artifact
  produced by the discovery conversation. It is the approval gate for a build.
- **Artifact** — an immutable, typed cognitive output (architecture, research,
  PRD, execution plan, verification report). Revisions are monotonic per
  `(projectId, type)`.
- **Build Run** — one product-level attempt to turn approved requirements into
  a project. It maps to one Workflow, one Execution, and a graph of Nodes.
- **HCR** — Hierarchical Cognitive Runtime: the six-node graph
  `ARCHITECT → RESEARCH → PRD_REVIEWER → PLANNER → FRONTEND_ENG + BACKEND_ENG`.
- **Node** — a bounded execution unit in a Build Run. Node state is durable in
  Postgres; Temporal schedules when it runs.
- **Agent Profile** — a cognitive role's configuration: instructions,
  capabilities, tool eligibility, model policy, and execution limits.
- **Context Request** — the runtime's declaration of what a node needs
  (project, task, prompt, policy); the Context Engine retrieves and assembles it.
- **Workspace** — the filesystem-canonical copy of generated project files under
  `DOABLE_HOME/projects/<projectId>`. Postgres holds metadata and a mirror.
- **Verification Report** — evidence about a workspace check or build/test run.
  `NOT_RUN` means no command executed; do not describe it as verified.
- **Runtime Event** — an append-only product fact (`node.created`,
  `artifact.created`, `model.usage`, `workflow.failed`, ...).
- **Local Mode** — single-user local profile, local Postgres, loopback binding,
  and a local or explicitly selected remote model provider.