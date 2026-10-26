import { describe, expect, test } from "bun:test";
import { hashArtifactContent } from "@/src/runtime/artifacts/create-artifact";
import { normalizeWorkspacePath } from "@/src/runtime/workspace";

describe("Workspace path safety", () => {
  test("normalizes relative paths and treats backslashes as separators", () => {
    expect(normalizeWorkspacePath("src\\components\\Button.tsx")).toBe(
      "src/components/Button.tsx",
    );
    expect(normalizeWorkspacePath("/src/App.tsx")).toBe("src/App.tsx");
  });

  test("rejects traversal and empty paths", () => {
    expect(() => normalizeWorkspacePath("../secrets.txt")).toThrow();
    expect(() => normalizeWorkspacePath("src/../../secrets.txt")).toThrow();
    expect(() => normalizeWorkspacePath("")).toThrow();
    expect(() => normalizeWorkspacePath("src/\0file.ts")).toThrow();
  });
});

describe("Artifact content hashing", () => {
  test("is stable across object key order", () => {
    const first = hashArtifactContent({ a: 1, b: ["x", "y"] });
    const second = hashArtifactContent({ b: ["x", "y"], a: 1 });
    expect(first).toBe(second);
  });

  test("changes when content changes", () => {
    expect(hashArtifactContent({ a: 1 })).not.toBe(
      hashArtifactContent({ a: 2 }),
    );
  });
});