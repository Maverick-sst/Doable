// Minimal ambient types for `bun:test` (Agent 04 verification scope only).
// The repo has no test runner dependency; `bun test` provides the runtime.
// This shim keeps `bunx tsc --noEmit --strict` meaningful without adding
// dependencies or touching the root tsconfig.
declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeDefined(): void;
    toBeNull(): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toContain(expected: unknown): void;
    toContainEqual(expected: unknown): void;
    toHaveLength(expected: number): void;
    toMatch(expected: string | RegExp): void;
    toThrow(expected?: string | RegExp | (new (...args: never[]) => Error)): void;
    not: {
      toBe(expected: unknown): void;
      toBeNull(): void;
      toThrow(expected?: string | RegExp | (new (...args: never[]) => Error)): void;
    };
  }
  export function expect(actual: unknown): Matchers;
}
