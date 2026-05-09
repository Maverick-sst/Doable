# Agent Guidelines for Doable

## Critical Safety Rules

### 1. Information Security
- **NEVER log, console.error, or output:**
  - API keys, tokens, or secrets (OpenRouter keys, Clerk tokens, database credentials)
  - User authentication data or personal identifiable information (PII)
  - Database connection strings or internal URLs
  - Memory access tokens or authentication headers
- **Only output sanitized, user-safe information** in responses and logs
- When handling sensitive data in code, ensure variables are never passed to logging or error handlers that might expose them
- Always use environment variables for secrets — never hardcode them

### 2. Code Integrity & Safety
- **NEVER:**
  - Override or modify existing database migrations
  - Delete or rename critical tables, columns, or enums without migration
  - Change authentication/authorization middleware without explicit review
  - Modify Prisma schema constraints that would break existing data
  - Override established API patterns (auth scoping, query optimization)
  - Alter webhook handlers or event flows that affect data consistency
- **ALWAYS:**
  - Create new migrations for any schema changes
  - Maintain backward compatibility unless explicitly breaking version
  - Preserve existing auth checks and user-scoping logic
  - Test changes against real data patterns

## Code Quality Standards

### 3. Cleanliness & Readability
- **Variable names:** Use descriptive, semantic names (`userId`, `projectContent`, not `x`, `data`)
- **Function names:** Clearly indicate purpose (`fetchUserProjects`, `validateFileContent`)
- **Comments:** Add context for *why*, not *what* — code should be self-documenting
- **Line length:** Keep lines under 100 characters for readability
- **Spacing:** Consistent indentation (2 spaces for JS/TS), blank lines between logical blocks
- **Type safety:** Always use TypeScript types, never `any` without explicit reason and comment

### 4. Maintainability
- **DRY principle:** Extract reusable logic into utility functions or shared helpers
- **Single responsibility:** Each function should do one thing well
- **Error handling:** Use try-catch where appropriate; provide meaningful error messages
- **Constants:** Define magic numbers/strings as named constants at module top
- **File organization:** Group related functions in same file; separate concerns into different files
- **Dependency management:** Keep imports organized; avoid circular dependencies

### 5. Extensibility
- **Avoid hardcoding:** Use configuration, enums, and environment variables
- **Patterns:** Follow established patterns from existing code (Zod validation, NextResponse, query scoping)
- **Hooks/Middleware:** Use framework provided mechanisms for adding behavior
- **Modular design:** Write code that allows features to be added without major refactoring
- **Testing readiness:** Structure code so it can be easily unit tested

### 6. API & Database Patterns
- **Auth scoping:** Every query must be scoped to authenticated user via `where: { user: { clerkId } }`
- **Validation:** All user input validated with Zod schemas in `/lib/validations/`
- **Responses:** Use `NextResponse.json()` with proper status codes
- **Select fields:** Always use `.select()` to fetch only needed fields
- **Relation queries:** Use single-level traversal: `where: { user: { clerkId } }` not nested includes
- **Error responses:** Return consistent error shape with descriptive message and proper HTTP status

## Next.js 15 Specifics

<!-- BEGIN:nextjs-agent-rules -->
## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. **Read the relevant guide in `node_modules/next/dist/docs/` before writing any code.** Heed deprecation notices.

**Key changes in Next.js 15:**
- App Router is the standard (no Pages Router)
- Server Components by default (use `'use client'` sparingly)
- Route handlers replace API routes middleware
- Streaming and Suspense are first-class features
- Environment variables: `NEXT_PUBLIC_*` for client, others are server-only
<!-- END:nextjs-agent-rules -->

## Pre-Implementation Checklist

Before writing code:
- [ ] Is this change aligned with existing patterns?
- [ ] Does it maintain auth/data scoping?
- [ ] Are there sensitive values that could leak?
- [ ] Is the code readable to someone unfamiliar with it?
- [ ] Can this scale with more users/data?
- [ ] Does this break any existing functionality?
- [ ] Are error cases handled gracefully?

## Questions?

When in doubt, refer to:
- Existing similar implementations in the codebase
- Type definitions in `/lib/validations/`
- Database schema in `/prisma/schema.prisma`
- Framework documentation in `node_modules/next/dist/docs/`
                                                                                                                                                                                                