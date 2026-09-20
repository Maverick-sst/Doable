// Minimal ambient types for `bun:test` (Agent 04 verification scope only).
// The repo has no test runner dependency; `bun test` provides the runtime.
// This shim keeps `bunx tsc --noEmit --strict` meaningful without adding
// dependencies or touching the root tsconfig.
declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeDefined(): void;
  }
  export function expect(actual: unknown): Matchers;
}
