# AGENT.md

## Mission

You are operating inside the Doable codebase.

Before making ANY modification:
1. Deeply understand the existing architecture
2. Read and understand:
   - `PHASE_4_PRD.md`
   - `JOB.md`
   - current Prisma schema
   - runtime architecture
   - workflow engine
   - artifact system
   - execution system
   - existing conventions and patterns
3. Preserve architectural integrity at all costs

Your job is NOT to rewrite the system.

Your job is to:
- carefully extend
- correctly wire
- safely integrate
- preserve stability
- preserve backward compatibility
- follow the Phase 4 architecture exactly

You must behave like a senior staff engineer working on a production-grade AI runtime system.

---

# PRIMARY OBJECTIVE

Implement Phase 4 exactly as defined in `PHASE_4_PRD.md` WITHOUT:
- breaking existing flows
- corrupting schema assumptions
- introducing runtime instability
- changing unrelated logic
- rewriting working systems
- introducing architectural drift

Everything added must feel native to the existing codebase.

---

# NON-NEGOTIABLE RULES

## DO NOT RUN COMMANDS

Under NO circumstances should you run:
- `bun run dev`
- `bun dev`
- `npm run dev`
- `pnpm dev`
- `npx`
- `prisma migrate`
- `prisma db push`
- `prisma generate`
- `docker`
- shell scripts
- database reset commands
- destructive commands
- installation commands
- any explicit bash command

DO NOT execute:
- migrations
- dev servers
- database commands
- seed commands
- test runners
- package installation
- filesystem cleanup commands

You are ONLY allowed to:
- read files
- create files
- modify files carefully

Nothing else.

---

# DO NOT BREAK THE DATABASE

You must preserve:
- existing schema integrity
- existing relations
- existing data assumptions
- existing enum values
- existing IDs
- existing workflow history

DO NOT:
- rename fields carelessly
- remove columns
- change relation semantics
- alter IDs
- change runtime contracts
- break backward compatibility

If a schema improvement is required:
- make the smallest safe change possible
- preserve compatibility
- preserve existing behavior

---

# PHASE 4 IS THE SOURCE OF TRUTH

`PHASE_4_PRD.md` is the implementation contract.

You must follow it strictly.

Especially preserve:
- workflow architecture
- execution lifecycle
- artifact philosophy
- discovery workflow
- HCR workflow
- runtime event flow
- memory system
- cognition/runtime separation
- versioning strategy
- artifact lineage assumptions
- orchestration model

Do NOT invent alternative architectures.

Do NOT simplify core runtime concepts.

Do NOT introduce abstractions not required by the PRD.

---

# EXISTING CODEBASE IS AUTHORITATIVE

Before modifying any file:
- inspect surrounding patterns
- inspect naming conventions
- inspect folder organization
- inspect error handling style
- inspect typing style
- inspect Prisma access patterns
- inspect API route patterns
- inspect runtime orchestration patterns

New code must feel like it was written by the original architect.

---

# IMPLEMENTATION PHILOSOPHY

You are NOT building isolated features.

You are wiring together:
- workflows
- executions
- nodes
- artifacts
- memory
- orchestration
- runtime events
- AI cognition

Every modification must preserve system coherence.

Favor:
- composability
- deterministic behavior
- runtime safety
- strong typing
- minimalism
- explicitness
- predictable execution

Avoid:
- magic abstractions
- hidden side effects
- unnecessary complexity
- giant utility files
- duplicated logic
- overengineering

---

# FILE MODIFICATION RULES

Before editing a file:
1. Read the entire file
2. Understand its role in architecture
3. Preserve existing patterns
4. Modify minimally

When creating files:
- place them in architecturally correct locations
- follow existing naming patterns
- avoid unnecessary nesting

Never create duplicate systems.

Never create parallel architectures.

Never bypass existing runtime patterns.

---

# PRISMA RULES

You may:
- modify schema safely
- add additive fields
- add indexes
- add enums carefully
- improve defaults safely

You must NOT:
- run migrations
- run generate
- reset database
- delete schema structures
- break relations
- alter production assumptions

Schema changes must remain migration-safe.

---

# TYPESCRIPT RULES

All code must:
- be fully typed
- avoid `any`
- preserve strict typing
- preserve runtime safety
- use existing shared types where possible

Prefer:
- small functions
- explicit interfaces
- deterministic returns
- readable orchestration

Avoid:
- deeply nested logic
- massive files
- implicit mutations
- unsafe casting

---

# RUNTIME SAFETY

Nothing should:
- crash existing flows
- block workflow execution
- corrupt artifacts
- create orphan records
- break execution lineage
- create inconsistent state

All new logic must:
- fail gracefully
- preserve transactional integrity
- maintain execution consistency

---

# ARTIFACT SYSTEM RULES

Artifacts are the canonical intelligence layer.

Preserve:
- immutable artifact philosophy
- versioned artifacts
- artifact lineage
- artifact type consistency
- workflow linkage

Never treat mutable memory as source of truth.

Artifacts are source of truth.

---

# EXECUTION SYSTEM RULES

Executions represent runtime units.

Preserve:
- execution lifecycle
- execution statuses
- node relationships
- workflow lineage
- runtime events

Do not bypass orchestration layers.

Do not directly mutate execution state outside intended flows.

---

# DISCOVERY + HCR RULES

Discovery:
- gathers requirements
- creates artifacts
- updates project understanding

HCR:
- consumes artifacts
- plans implementation
- orchestrates execution

Do NOT mix responsibilities.

Maintain strict cognition boundaries.

---

# WHEN UNSURE

If implementation details are ambiguous:
1. Follow existing architecture
2. Follow `PHASE_4_PRD.md`
3. Choose the safest minimal change
4. Preserve compatibility
5. Avoid introducing new systems

---

# FINAL EXPECTATION

Your responsibility is to make the codebase:
- more coherent
- more stable
- more aligned with Phase 4
- production-safe
- architecturally consistent

WITHOUT:
- regressions
- destructive changes
- runtime instability
- unnecessary rewrites
- command execution
- environment mutation

Treat the codebase like a live production system.
