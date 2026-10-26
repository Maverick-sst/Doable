# Doable Cortex Reconstruction — Agent 01
# Agent Configuration Boundary

## Phase

**Cortex Runtime Decomposition — Phase 1**

This task establishes the **Agent Configuration** boundary before extracting the Messages/Context Engine, Memory, Background Workflows, Agent Loop, Tools/Execution, Sessions/Delegation, Model Router, and Operations/Evaluation.

The implementation must preserve the behavior already established by the current HCR + Temporal runtime.

---

# 1. Mission

Refactor/extract the **agent configuration responsibility** from the current HCR/cognition runtime into an explicit, production-ready boundary.

The objective is **not** to redesign the agent.

The objective is to make the runtime able to answer:

> **What agent is being executed, what is this agent configured to do, what capabilities does it have, and what execution constraints apply?**

Agent Configuration becomes a stable input to the future Cortex Agent Loop.

---

# 2. Why This Exists

The current runtime historically combines several responsibilities in the same execution path:

```text
agent identity
prompt/instructions
model selection
context retrieval
memory retrieval
LLM call
tool execution
Prisma persistence
workflow orchestration
```

This task separates **only the configuration responsibility**.

Do NOT attempt to solve all of the above in this task.

Future dependency direction:

```text
Temporal Workflow
       ↓
Agent Loop
       ↓
Agent Configuration
       ↓
Context / Policy / Model Router / Tools
```

Agent Configuration is a dependency consumed by the runtime rather than the runtime constructing configuration ad hoc.

---

# 3. Cortex Context That Must Be Preserved

The Cortex architecture discussed for Doable includes an explicit configuration layer around the agent loop.

Preserve these conceptual pieces:

```text
Agent identity
Agent instructions
Agent YAML / structured configuration
Prompt manager
Experiments
Session state references
Capabilities
Execution constraints
```

Do not collapse these concepts into a single arbitrary prompt string.

The system must represent configuration separately from dynamic runtime context.

---

# 4. Agent Configuration Is NOT Context

## Agent Configuration

Relatively stable information describing the agent:

```text
Who is the agent?
What is its role?
What instructions govern it?
What capabilities are available?
What tools may it request?
What model constraints apply?
What execution limits apply?
What configuration/experiment variant is active?
```

## Context

Dynamic information required for the current execution:

```text
current user message
conversation history
project state
execution state
artifacts
memory
retrieved information
tool results
previous model outputs
summaries
compacted history
```

The Context Engine will be implemented later.

This task must NOT become a Context Engine implementation.

---

# 5. Required Configuration Model

Create an explicit internal configuration contract.

The exact TypeScript names may follow existing repository conventions, but the conceptual contract should contain at least:

```ts
type AgentConfig = {
  agentId: string;
  agentType: string;
  instructions: string;
  capabilities: AgentCapability[];
  toolPolicy: ToolPolicyReference;
  modelPolicy: ModelPolicyReference;
  executionPolicy: ExecutionPolicyReference;
  experiment?: ExperimentReference;
  version?: string;
};
```

This is a conceptual minimum, not permission to blindly copy the shape.

First inspect existing code and reuse existing types where they already represent the same concept. Do not create duplicate representations unnecessarily.

---

---

# 5A. Preserve the Existing Doable Agent Catalog

**Mandatory: do not invent a new agent catalog during this task.**

The current Doable cognition layer already contains concrete agent/node definitions and dedicated system prompts. These existing roles are the initial Cortex agent catalog:

```text
ARCHITECT
RESEARCH
PRD_REVIEWER
PLANNER
FRONTEND_ENG
BACKEND_ENG
```

Normalize and extract these existing roles into the new Agent Configuration boundary; do not replace them with a new set of agents.

## Existing prompt mapping

```text
ARCHITECT      → ARCHITECT_SYSTEM_PROMPT
RESEARCH       → RESEARCHER_SYSTEM_PROMPT
PRD_REVIEWER   → PRD_REVIEWER_SYSTEM_PROMPT
PLANNER        → STAFF_ENGINEER_SYSTEM_PROMPT
FRONTEND_ENG   → FRONTEND_ENGINEER_SYSTEM_PROMPT
BACKEND_ENG    → BACKEND_ENGINEER_SYSTEM_PROMPT
```

The existing prompt files are the behavioral baseline. Do not rewrite, improve, shorten, combine, or otherwise clean them up during this extraction.

---

# 5B. Distinguish Node Type From Agent Type

Do not automatically assume:

```text
NodeType === AgentType
```

The current registry maps `NodeType.PLANNER` to `STAFF_ENGINEER_SYSTEM_PROMPT`. Preserve that relationship and document it rather than silently renaming it. Conceptually:

```text
Workflow Node
      ↓
Agent Type / Cognitive Role
      ↓
Agent Configuration
      ↓
Instructions + capabilities + policies
```

Do not introduce a new `AgentType` enum merely for architectural symmetry. First determine whether existing `NodeType` plus explicit metadata is sufficient. If a distinct abstraction is genuinely necessary, document why before introducing it.

---

# 5C. Existing Registry Is the Migration Source

Treat the current `AGENT_REGISTRY` as the source of truth for this extraction. Its current `NodeConfig` mixes responsibilities that will later belong to separate Cortex components:

```text
CURRENT NodeConfig
│
├── Agent Configuration
│   ├── identity / role
│   └── system instructions
│
├── Context Engine
│   └── contextConfig
│
├── Execution Policy
│   └── maxIterations
│
├── Tool Policy
│   └── usesFileTools
│
└── Output / Artifact Contract
    ├── outputArtifactType
    ├── consumedArtifactTypes
    └── outputMode
```

Do not move all of these fields into `AgentConfig` simply because they currently live together. Establish clean ownership.

---

# 5D. Prompt Preservation Is a Hard Requirement

For every existing agent, record:

```text
current identifier
current prompt source
current node mapping
current output expectations
current context expectations
current tool expectations
```

The same agent must continue resolving to the same effective prompt. Do not alter prompt contents as part of this migration.

---

# 5E. Do Not Invent “Cortex Agents”

Not every Cortex box is an autonomous cognitive agent. Do NOT create placeholder agents such as:

```text
CONTEXT_AGENT
MEMORY_AGENT
MODEL_ROUTER_AGENT
TOOL_AGENT
POLICY_AGENT
SESSION_AGENT
CACHE_AGENT
```

Those are runtime/service responsibilities. New cognitive agents should emerge only from a concrete Doable requirement.

---

# 5F. New Agent Types Require Evidence

If implementation reveals a genuine need for a new cognitive role, do not silently add it. Report:

```text
NEW AGENT CANDIDATE

Name:
Reason:
Current responsibility that cannot cleanly own this behavior:
Why an existing agent cannot perform the role:
Required prompt:
Required capabilities:
Required tools:
Expected output:
```

Then stop and let the architectural owner decide whether it belongs in the catalog.

---

# 5G. Desired First Stable State

The first successful state should preserve the existing six cognitive roles behind the new configuration boundary:

```text
                    Agent Configuration
                           │
          ┌────────────────┼────────────────┐
          │                │                │
      ARCHITECT        RESEARCHER      PRD_REVIEWER
          │                │                │
     existing prompt  existing prompt  existing prompt

          ┌────────────────┼────────────────┐
          │                │                │
   STAFF_ENGINEER     FRONTEND_ENG      BACKEND_ENG
          │                │                │
     existing prompt  existing prompt  existing prompt
```

Only after this stable catalog exists should later phases consider new specialized agents, sub-agents, delegation, or dynamic agent configuration.

# 6. Configuration Responsibilities

## 6.1 Agent Identity

Examples:

```text
ARCHITECT
RESEARCHER
PRD_REVIEWER
STAFF_ENGINEER
FRONTEND_ENG
BACKEND_ENG
```

Distinguish **agent type/role** from a particular execution.

Agent configuration should not own:

```text
executionId
workflowId
nodeId
Temporal run ID
```

unless an existing contract explicitly requires a reference.

Those belong to runtime/execution identity.

---

## 6.2 Instructions

Configuration may provide:

```text
system instructions
role instructions
behavioral constraints
output expectations
```

Do not rewrite existing prompts during this task.

If prompts are currently embedded in agent code, extract them conservatively behind the configuration boundary. Preserve wording and behavior unless the extraction itself requires a mechanical change.

---

## 6.3 Capabilities

Represent what the agent is capable of requesting.

Examples:

```text
research
filesystem access
code generation
artifact creation
database reads
code execution
web access
```

Capabilities are declarative. They do not execute anything.

---

## 6.4 Tool Policy Reference

Agent Configuration may state which tool classes an agent is permitted to use.

It must **not load every tool**.

The future Cortex design includes **semantic tool discovery/search**, followed by selective loading of a small relevant toolset.

Therefore:

```text
Agent Configuration
        ↓
declares capability/tool eligibility
        ↓
Tool discovery system
        ↓
semantic search
        ↓
small selected toolset
        ↓
Tool Runtime
```

Do NOT implement semantic tool search in this task.

Do NOT preload all tools into Agent Configuration.

Do NOT put full tool definitions into every agent prompt.

---

# 7. Model Policy Must Remain Separate

Do not make a provider/model invocation part of Agent Configuration.

The future Model Router must be capable of handling:

```text
provider selection
model selection
fallback
health
cost
task characteristics
prompt-cache considerations
```

Therefore Agent Configuration expresses **model preferences/constraints**, not provider invocation.

Conceptually:

```text
AgentConfig
    ↓
ModelPolicy
    ↓
Model Router
    ↓
Provider
```

The Model Router is a later boundary. Do not migrate the LLM implementation here.

---

# 8. Prompt Caching Must Be Preserved

Prompt caching is an established architectural concern and must not be accidentally destroyed.

Do not casually concatenate:

```text
agent instructions
+
conversation
+
tools
+
memory
+
dynamic context
```

into one newly generated prompt structure.

The future runtime needs stable configuration separated from dynamic context so cache-sensitive prompt structure can be managed deliberately.

Do NOT claim that this task implements the final prompt-cache algorithm.

For this task:

1. preserve existing prompt behavior;
2. keep stable agent instructions/configuration structurally identifiable;
3. avoid unnecessary dynamic values in configuration;
4. do not move tool catalogs into static agent configuration;
5. document existing prompt-cache behavior discovered during source inspection.

---

# 9. Experiments

The Cortex configuration layer includes experiments/configuration variants.

Represent experiments as configuration metadata rather than embedding experiment logic throughout execution.

Conceptually:

```text
AgentConfig
   ↓
ExperimentReference
   ↓
resolved configuration
```

Do not build an experimentation platform in this task.

Do not introduce random assignment.

If the repository has no experiment mechanism, define the smallest typed extension point and document it rather than inventing a full system.

---

# 10. Session State Boundary

The Cortex architecture also exposes session state.

Do not put mutable session history inside `AgentConfig`.

Configuration may contain:

```text
session policy
session capability requirements
```

but not:

```text
entire conversation
tool history
memory
current context
runtime state
```

Those belong to the future Session/Context system.

---

# 11. Persistence Rules

Do not create a second product-state database.

Postgres remains the product source of truth.

First determine whether existing entities already represent:

```text
agent type
node type
agent configuration
execution configuration
```

If existing persistence is sufficient, create a runtime/configuration adapter over it.

If persistence is genuinely missing, **stop and report the gap rather than introducing schema changes in this task**.

---

# 12. Runtime Contract

The future Agent Loop should be able to consume configuration approximately like:

```ts
const agentConfig = await agentConfigProvider.resolve({
  agentType,
  projectId,
  executionId,
});

await agentLoop.run({
  agentConfig,
  input,
});
```

The Agent Loop should not need to know whether configuration came from static definitions, database, YAML, filesystem, an experiment resolver, or a future configuration service.

That implementation detail belongs behind the provider/resolver boundary.

---

# 13. Temporal Constraint

Temporal Workflow:

```text
orchestrates
```

Temporal Activity:

```text
performs external I/O / configuration resolution
```

Agent Configuration:

```text
describes agent behavior/capabilities
```

Agent Loop:

```text
will later coordinate execution
```

Do not put configuration loading, Prisma access, filesystem access, or LLM calls inside a Temporal Workflow.

---

# 14. What NOT To Touch

Unless a compile/test failure makes a minimal mechanical change unavoidable, do NOT modify:

```text
prisma/**
app/api/**
src/temporal/**
# tool execution
# MCP implementation
# sandbox implementation
# memory implementation
# RAG implementation
# context engine
# LLM/provider implementation
# model router
# session implementation
# delegation
# background workflows
# UI
# Inngest implementation
# Temporal workflow semantics
```

Do not migrate the entire HCR runtime.

Do not rewrite `runHcrNodeActivity`.

Do not change existing agent prompts for quality reasons.

Do not refactor unrelated cognition code.

---

# 15. Strict Scope

This agent owns only:

```text
Agent Configuration
Configuration Provider / Resolver
Agent configuration types
Configuration adapters
Configuration documentation
Tests specifically covering configuration resolution
```

Suggested directory shape:

```text
src/cortex/
    agent-config/
        types.ts
        provider.ts
        resolver.ts
        definitions/
        index.ts
```

This is a suggestion, not an instruction to create every file. Follow existing repository conventions where appropriate.

---

# 16. File Ownership

The agent may create or modify ONLY files inside the chosen Agent Configuration boundary and narrowly scoped tests/documentation directly associated with it.

If implementation requires changing another subsystem:

### STOP.

Report:

```text
CONFLICT:
File:
Reason:
Why the change appears necessary:
Alternative considered:
```

Do not silently expand scope.

---

# 17. Production Code Requirements

Prefer:

```text
small interfaces
typed contracts
dependency injection
pure configuration objects
explicit resolution
stable identifiers
clear error boundaries
```

Avoid:

```text
global mutable configuration
singleton state
hidden environment coupling
magic strings everywhere
large generic factories
"smart" configuration objects that perform execution
```

Configuration should be easy to inspect during debugging.

---

# 18. Comments

Comments are required only where they explain an architectural decision.

Good:

```ts
// Agent configuration is resolved outside the Temporal Workflow because
// configuration sources may require external I/O. The Workflow receives
// only the resolved, serializable configuration it needs to orchestrate.
```

Bad:

```ts
// Get the config
const config = ...
```

Do not narrate obvious code.

---

# 19. Tests

At minimum test:

### Configuration resolution

```text
known agent type → expected configuration
unknown agent type → explicit failure
```

### Configuration isolation

Verify resolving configuration does not mutate shared/global configuration.

### Tool eligibility

Verify configuration declares eligibility without loading the actual tool catalog.

### Model policy

Verify model preference/constraints are represented without invoking a provider.

### Prompt preservation

Verify extracted configuration contains the same effective agent instructions currently used by the relevant HCR node.

Do not add tests for systems not implemented in this task.

---

# 20. Validation

Run the repository's normal validation commands.

At minimum, where available:

```bash
bun run typecheck
```

Also verify:

```text
existing Temporal pilot still works
existing HCR behavior is unchanged
no Inngest behavior has been removed
```

Do not modify lockfiles/generated files merely to make tests pass.

---

# 21. Definition of Done

- [ ] Agent Configuration has an explicit typed contract.
- [ ] Agent identity is separated from execution identity.
- [ ] Instructions are separated from dynamic context.
- [ ] Capabilities are declarative.
- [ ] Tool eligibility is declarative.
- [ ] Tools are NOT preloaded.
- [ ] Model preferences are separated from model invocation.
- [ ] Prompt-cache-sensitive configuration has not been casually mixed with dynamic context.
- [ ] Experiment support has a clean extension point without a new experimentation platform.
- [ ] Session history is not stored in Agent Configuration.
- [ ] No Prisma schema change was introduced.
- [ ] No Temporal Workflow performs external I/O.
- [ ] Existing HCR cognition remains behaviorally unchanged.
- [ ] Existing Temporal durability remains functional.
- [ ] Tests cover configuration resolution and failure boundaries.
- [ ] Changed files are strictly within scope.

---

# 22. Handoff Report

When finished, report exactly:

```text
Branch:
Commit:

Mission:
What Agent Configuration now owns:

Files changed:
- ...

Files intentionally NOT changed:
- ...

Configuration contract:
- ...

Resolution mechanism:
- ...

Prompt-cache considerations:
- ...

Tool-loading considerations:
- ...

Model-router boundary:
- ...

Session/context boundary:
- ...

Tests:
- command
- result

Typecheck:
- result

Temporal regression:
- result

HCR regression:
- result

Known gaps:
- ...

Scope violations:
- none / list
```

---

# 23. Next Boundaries — Do NOT Implement Yet

After this branch is reviewed and merged, build the next boundaries in order:

```text
01. Agent Configuration
        ↓
02. Messages / Context Engine
        ↓
03. Memory
    ├── semantic
    ├── episodic
    └── procedural
        ↓
04. Background Workflows
    ├── cache refresh
    ├── fast-turn cache refresh
    ├── incremental workflows
    └── memory curator
        ↓
05. Agent Loop
        ↓
06. Tools / Execution
    ├── semantic tool discovery
    ├── selective tool loading
    ├── tool scheduler
    ├── MCP
    └── sandbox
        ↓
07. Sessions / Delegation
        ↓
08. Model Router
        ↓
09. Operations / Evaluation
```

Do not implement these opportunistically while completing Agent Configuration.

---

# Final Principle

The goal is not to make the codebase merely resemble a diagram.

The goal is to reproduce the **responsibility boundaries** represented by the Cortex architecture while preserving the behavior already built in Doable.

Every extraction follows:

```text
UNDERSTAND
    ↓
DEFINE BOUNDARY
    ↓
EXTRACT WITHOUT BEHAVIOR CHANGE
    ↓
TEST
    ↓
MERGE
    ↓
ONLY THEN BUILD THE NEXT BOUNDARY
```

Do not optimize for number of files.

Optimize for:

```text
clear ownership
replaceable components
deterministic orchestration
durable execution
cache-aware context construction
selective memory retrieval
selective tool loading
observable behavior
```
