# AGENT.md — Phase 5B Testing Console / HCR Observability Dashboard

## Mission

You are operating inside the Doable codebase.

Phase 5 successfully established the HCR backend:

```txt
Discovery
      ↓
Architect
      ↓
Researcher
      ↓
PRD Reviewer
      ↓
Staff Engineer
      ↓
Frontend Engineer
      ↓
Backend Engineer
```

The runtime now supports:

- workflows
- executions
- nodes
- artifact lineage
- runtime events
- workflow coordination
- HCR progression

However:

The existing testing dashboard was designed for the earlier architecture:

```txt
Discovery
      ↓
Architect
      ↓
Filesystem
```

It primarily visualizes:

- project state
- messages
- files
- generated outputs

This is no longer sufficient.

---

# PRIMARY OBJECTIVE

Transform the existing testing dashboard into an:

# HCR Inspection Console

The goal is NOT UI beauty.

The goal is NOT production UX.

The goal is:

```txt
Observe
Understand
Debug
Validate
```

the HCR runtime.

This dashboard will become the primary tool used to evaluate:

- artifact quality
- node quality
- workflow progression
- runtime correctness

before any optimization work begins.

---

# CRITICAL PHILOSOPHY

The system is no longer file-centric.

The system is now:

```txt
Artifact-Centric
```

The testing console must reflect that.

The primary object of inspection is:

```txt
Artifact
```

not:

```txt
Generated Files
```

Files are downstream effects.

Artifacts are the source of truth.

---

# EXISTING DASHBOARD MUST BE PRESERVED

Do NOT rebuild from scratch.

Do NOT remove working functionality.

Preserve:

- project creation
- project loading
- discovery flow
- HCR triggering
- status polling
- logs
- file explorer
- file preview

All existing functionality remains valuable.

The objective is:

```txt
Extend
Not Replace
```

---

# DELIVERABLE 1

## Artifact Pipeline Viewer

Create a dedicated section:

```txt
Artifact Pipeline
```

This becomes the most important area of the dashboard.

The viewer must display the complete artifact lineage:

```txt
Requirements
      ↓
Architecture Spec
      ↓
Research Dossier
      ↓
Approved PRD
      ↓
Execution Plan
      ↓
Frontend Mutations
      ↓
Backend Mutations
```

Each artifact should display:

```txt
Artifact Type
Version
Status
Producer Node
Created At
Artifact ID
```

Artifacts should be ordered chronologically.

---

# DELIVERABLE 2

## Artifact Inspector

Selecting an artifact should open a detailed viewer.

Display:

```txt
Artifact Metadata
```

including:

```txt
Artifact ID
Type
Version
Workflow ID
Execution ID
Node ID
Producer
Created At
```

and

```txt
Artifact Content
```

The content viewer should support:

- large JSON payloads
- formatted rendering
- scrolling
- copy support

The goal is to inspect artifact quality.

Do not truncate content.

---

# DELIVERABLE 3

## HCR Node Timeline

Create a dedicated section:

```txt
Node Execution Timeline
```

Display every node executed during the workflow.

Example:

```txt
✓ Architect
✓ Researcher
✓ PRD Reviewer
✓ Staff Engineer
✓ Frontend Engineer
✓ Backend Engineer
```

For every node show:

```txt
Node Type
Status
Started At
Completed At
Duration
Artifact Produced
```

This timeline must reflect actual runtime data.

Do not hardcode node types.

Read from runtime state.

---

# DELIVERABLE 4

## Runtime Event Stream

Create a live runtime event viewer.

Display:

```txt
workflow.created
execution.created
node.created
node.running
node.completed
artifact.created
workflow.completed
workflow.failed
```

ordered chronologically.

Each event should expose:

```txt
Timestamp
Event Type
Entity ID
Relevant Metadata
```

The event stream becomes the debugging console.

---

# DELIVERABLE 5

## Workflow Summary Panel

Create a workflow summary section.

Display:

```txt
Workflow Status
Workflow Type
Current Node
Total Nodes
Completed Nodes
Artifacts Produced
Execution Count
```

This should give a quick overview of system health.

---

# DELIVERABLE 6

## Cognitive Progress Visualization

The user should be able to visually understand:

```txt
Discovery
      ↓
Architect
      ↓
Researcher
      ↓
PRD Reviewer
      ↓
Staff Engineer
      ↓
Frontend
      ↓
Backend
```

This does NOT need:

- ReactFlow
- Graph Visualization
- Complex Diagrams

Simple timeline visualization is sufficient.

The purpose is runtime clarity.

---

# DELIVERABLE 7

## Artifact Quality Workflow

The dashboard should make it easy to answer:

### Question 1

```txt
Did the workflow run?
```

### Question 2

```txt
Which nodes executed?
```

### Question 3

```txt
Which artifacts were produced?
```

### Question 4

```txt
What exactly is inside the artifact?
```

### Question 5

```txt
Was the artifact actually good?
```

The dashboard should optimize for these questions.

---

# DO NOT BUILD

Do NOT build:

```txt
Repair Loops
Replay UI
Workflow Editing
Prompt Editing
Agent Configuration
Sandbox Controls
Git Controls
Deployment Controls
Analytics
Cost Dashboards
Optimization Dashboards
```

These belong to later phases.

---

# UI PHILOSOPHY

Favor:

```txt
Simple
Dense
Debuggable
Information Rich
Fast
```

Avoid:

```txt
Marketing UI
Fancy Animations
Heavy Visualizations
Design Experiments
```

This is an engineering console.

Not a product interface.

---

# DATA SOURCES

Before creating new APIs:

Inspect existing:

```txt
workflow tables
execution tables
node tables
artifact tables
runtime events
status endpoints
dashboard APIs
```

Prefer reusing existing infrastructure.

Only create new APIs when absolutely necessary.

---

# BACKWARD COMPATIBILITY

Existing testing workflows must continue working.

Nothing should break:

```txt
Project Creation
Discovery
HCR Triggering
Polling
File Viewing
Logs
```

All additions must be additive.

---

# RUNTIME SAFETY

Do NOT:

- modify orchestration logic
- modify workflow transitions
- modify HCR execution
- modify coordinator behavior

This task is:

```txt
Observability
Inspection
Visibility
```

Only.

---

# DEFINITION OF DONE

The testing console is complete when a developer can:

1. Create a project
2. Run discovery
3. Trigger HCR
4. Watch node progression
5. Inspect artifacts
6. Inspect runtime events
7. Inspect workflow status
8. Validate artifact quality

without opening the database.

At that point the dashboard becomes the primary Phase 5 validation environment.