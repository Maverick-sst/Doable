# PRD — Phase 5B
# HCR Inspection Console & Artifact Validation Dashboard

**Project:** Doable  
**Phase:** 5B  
**Status:** Ready For Implementation  
**Owner:** Runtime / Frontend Infrastructure  
**Priority:** Critical

---

# Executive Summary

Phase 5A successfully completed the backend HCR architecture.

The system now supports:

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

with:

- Workflow lineage
- Execution lineage
- Node orchestration
- Artifact progression
- Runtime events
- Workflow coordination

However, the frontend testing dashboard still reflects an older runtime model.

The current dashboard primarily focuses on:

```txt
Project
Messages
Files
Logs
```

while the backend has evolved into an:

```txt
Artifact Driven Cognitive Runtime
```

This creates a major visibility gap.

---

# Problem Statement

Today, developers cannot easily answer:

```txt
Did the HCR pipeline execute correctly?

Which nodes ran?

What artifacts were produced?

What is inside each artifact?

Where did the workflow fail?

Was the artifact actually good?
```

To answer these questions today developers must:

- inspect the database
- inspect logs
- inspect runtime events manually
- inspect generated files

This slows development dramatically.

---

# Objective

Transform the current testing dashboard into an:

# HCR Inspection Console

The dashboard must become the primary environment used to:

- validate artifact quality
- validate node quality
- validate workflow progression
- validate runtime correctness

before any optimization work begins.

---

# Success Metrics

A developer should be able to:

1. Create a project
2. Complete discovery
3. Trigger HCR execution
4. Watch node progression live
5. Inspect every artifact produced
6. Inspect runtime events
7. Understand workflow state
8. Evaluate artifact quality

without touching the database.

---

# Scope

This phase focuses exclusively on:

```txt
Observability
Inspection
Validation
Debugging
```

This phase does NOT focus on:

```txt
Optimization
Repair Loops
Replayability
Prompt Editing
Agent Configuration
Sandboxing
Deployment
CI/CD
Git Integration
Analytics
```

---

# Existing Dashboard Requirements

The current dashboard is functional and must be preserved.

The following capabilities must remain intact:

```txt
Project Creation
Project Loading
Discovery Flow
HCR Triggering
Polling
File Explorer
File Preview
Logs
```

No existing functionality should be removed.

All changes must be additive.

---

# Core Design Principle

The dashboard must evolve from:

```txt
File-Centric
```

to:

```txt
Artifact-Centric
```

The most important object in the runtime is now:

```txt
Artifact
```

Files are merely outputs of artifact progression.

Artifacts are the source of truth.

---

# Feature 1
# Artifact Pipeline Viewer

---

## Purpose

Provide complete visibility into artifact lineage.

---

## User Story

As a developer,

I want to see every artifact produced by the HCR pipeline,

so that I can evaluate cognitive quality.

---

## Requirements

Display artifacts in execution order.

Example:

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

---

## Artifact Card Data

Every artifact card should display:

```txt
Artifact Type
Version
Status
Producer Node
Created At
Artifact ID
```

---

## Behavior

Artifacts should:

- load dynamically
- update while workflow executes
- display chronological ordering

---

# Feature 2
# Artifact Inspector

---

## Purpose

Allow deep inspection of artifact contents.

---

## User Story

As a developer,

I want to inspect the actual artifact payload,

so that I can evaluate output quality.

---

## Requirements

Selecting an artifact opens an inspector panel.

---

## Metadata Section

Display:

```txt
Artifact ID
Artifact Type
Version
Workflow ID
Execution ID
Node ID
Producer
Created At
```

---

## Content Section

Display:

```txt
Full Artifact Payload
```

Requirements:

- formatted JSON
- syntax highlighting if possible
- scroll support
- copy support
- expandable content

No truncation.

---

# Feature 3
# HCR Node Timeline

---

## Purpose

Visualize cognitive execution progression.

---

## User Story

As a developer,

I want to see which nodes executed,

so that I can understand workflow behavior.

---

## Requirements

Display all nodes executed.

Example:

```txt
✓ Architect

✓ Researcher

✓ PRD Reviewer

✓ Staff Engineer

✓ Frontend Engineer

✓ Backend Engineer
```

---

## Node Metadata

Each node should display:

```txt
Node Type
Status
Started At
Completed At
Duration
Produced Artifact
```

---

## Data Source

Must come from actual runtime state.

Never hardcode node types.

---

# Feature 4
# Runtime Event Stream

---

## Purpose

Provide runtime observability.

---

## User Story

As a developer,

I want to see runtime events in chronological order,

so that I can debug execution.

---

## Requirements

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

---

## Event Metadata

Display:

```txt
Timestamp
Event Type
Entity ID
Workflow ID
Execution ID
Relevant Metadata
```

---

## Behavior

Events should:

- appear in chronological order
- update live during execution
- support scrolling

---

# Feature 5
# Workflow Summary Panel

---

## Purpose

Provide a high-level workflow overview.

---

## User Story

As a developer,

I want a quick overview of runtime health,

so that I can immediately understand execution state.

---

## Requirements

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

---

# Feature 6
# Cognitive Progress View

---

## Purpose

Provide visual understanding of HCR progression.

---

## Requirements

Display:

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

---

## Constraints

Do NOT use:

```txt
ReactFlow
Complex Graph Systems
Heavy Visualization Libraries
```

A clean timeline is sufficient.

---

# Feature 7
# Artifact Quality Evaluation Workflow

---

The dashboard should make it easy to answer:

### Question 1

```txt
Did the workflow execute?
```

---

### Question 2

```txt
Which nodes executed?
```

---

### Question 3

```txt
Which artifacts were produced?
```

---

### Question 4

```txt
What is inside each artifact?
```

---

### Question 5

```txt
Was the artifact good?
```

These questions are the primary purpose of the dashboard.

---

# API Strategy

Before introducing new APIs:

Inspect and reuse existing:

```txt
Workflow APIs
Execution APIs
Artifact APIs
Runtime Event APIs
Dashboard APIs
Polling APIs
```

New endpoints should only be created if existing APIs cannot provide required data.

---

# Performance Expectations

The dashboard is:

```txt
Developer Tooling
```

not:

```txt
Customer Facing Product
```

Prioritize:

```txt
Correctness
Visibility
Debuggability
```

over:

```txt
Animations
Micro-interactions
Visual Complexity
```

---

# Out Of Scope

The following are explicitly excluded:

```txt
Repair Loops
Replay System
Prompt Editing
Agent Editing
Sandbox Controls
Git Controls
Deployment Controls
Analytics
Cost Tracking
Optimization Metrics
Model Comparison
```

These belong to future phases.

---

# Definition Of Done

The HCR Inspection Console is complete when a developer can:

```txt
Create Project
      ↓
Run Discovery
      ↓
Trigger HCR
      ↓
Observe Node Progression
      ↓
Inspect Runtime Events
      ↓
Inspect Artifacts
      ↓
Evaluate Artifact Quality
```

without opening:

- Prisma Studio
- Database tables
- Runtime logs
- Backend code

At that point the dashboard becomes the official validation environment for the HCR runtime.