import { describe, expect, test } from "vitest";

import {
  classifyChanges,
  diffIsExportKeywordsOnly,
  lineAddsExportKeyword,
} from "../classifyChanges.js";

const VITEST_PATTERNS = [/\.vitest\.ts$/, /\/__tests__\//];
const SOURCE_PATTERN = /^(packages|services|tools)\/.+\/src\/.+\.ts$/;

describe("classifyChanges", () => {
  test("routes test files to testFiles[]", () => {
    const result = classifyChanges({
      changedFiles: [
        { path: "packages/foo/src/__tests__/bar.vitest.ts", oldSource: "", newSource: "x" },
      ],
      testFilePatterns: VITEST_PATTERNS,
      sourcePathPattern: SOURCE_PATTERN,
    });
    expect(result.ok).toBe(true);
    expect(result.testFiles).toEqual(["packages/foo/src/__tests__/bar.vitest.ts"]);
    expect(result.disallowed).toEqual([]);
  });

  test("export-only source edits pass", () => {
    const result = classifyChanges({
      changedFiles: [
        {
          path: "packages/foo/src/bar.ts",
          oldSource: "function x() {}\nconst y = 1;\n",
          newSource: "export function x() {}\nexport const y = 1;\n",
        },
      ],
      testFilePatterns: VITEST_PATTERNS,
      sourcePathPattern: SOURCE_PATTERN,
    });
    expect(result.ok).toBe(true);
    expect(result.exportOnlyEdits).toEqual(["packages/foo/src/bar.ts"]);
    expect(result.disallowed).toEqual([]);
  });

  test("non-export source edits land in disallowed", () => {
    const result = classifyChanges({
      changedFiles: [
        {
          path: "packages/foo/src/bar.ts",
          oldSource: "const x = 1;\n",
          newSource: "const x = 2;\n",
        },
      ],
      testFilePatterns: VITEST_PATTERNS,
      sourcePathPattern: SOURCE_PATTERN,
    });
    expect(result.ok).toBe(false);
    expect(result.disallowed).toEqual(["packages/foo/src/bar.ts"]);
  });

  test("file outside source whitelist lands in disallowed even if export-only", () => {
    const result = classifyChanges({
      changedFiles: [
        {
          path: "README.md",
          oldSource: "x",
          newSource: "export x",
        },
      ],
      testFilePatterns: VITEST_PATTERNS,
      sourcePathPattern: SOURCE_PATTERN,
    });
    expect(result.ok).toBe(false);
    expect(result.disallowed).toEqual(["README.md"]);
  });

  test("rename (oldSource=empty, newSource=existing) is disallowed by line-count mismatch", () => {
    // `git diff --name-only` reports only the new name for renames. The
    // adapter resolves `oldSource` to "" for the new name (file did not exist
    // there in baseRef). classifyChanges then sees a line-count mismatch and
    // routes to disallowed — even a content-identical rename fails the gate.
    const result = classifyChanges({
      changedFiles: [
        {
          path: "packages/foo/src/renamed.ts",
          oldSource: "",
          newSource: "export const x = 1;\n",
        },
      ],
      testFilePatterns: VITEST_PATTERNS,
      sourcePathPattern: SOURCE_PATTERN,
    });
    expect(result.ok).toBe(false);
    expect(result.disallowed).toEqual(["packages/foo/src/renamed.ts"]);
  });

  test("classifies consistently when patterns have the /g flag (stateful regex)", () => {
    // Regression: `/\.vitest\.ts$/g` keeps `lastIndex` across `.test()` calls,
    // so a second call on the same RegExp can return false even when the path
    // matches. Multiple files of the same type must all classify the same way.
    const statefulVitest = /\.vitest\.ts$/g;
    const statefulSource = /^packages\/.+\/src\/.+\.ts$/g;
    const result = classifyChanges({
      changedFiles: [
        { path: "packages/a/src/__tests__/x.vitest.ts", oldSource: "", newSource: "x" },
        { path: "packages/b/src/__tests__/y.vitest.ts", oldSource: "", newSource: "y" },
        { path: "packages/c/src/__tests__/z.vitest.ts", oldSource: "", newSource: "z" },
      ],
      testFilePatterns: [statefulVitest],
      sourcePathPattern: statefulSource,
    });
    expect(result.ok).toBe(true);
    expect(result.testFiles).toHaveLength(3);
    expect(result.disallowed).toEqual([]);
  });

  test("mixed classification preserves each bucket", () => {
    const result = classifyChanges({
      changedFiles: [
        { path: "packages/a/src/__tests__/x.vitest.ts", oldSource: "", newSource: "x" },
        {
          path: "packages/a/src/x.ts",
          oldSource: "const x = 1;\n",
          newSource: "export const x = 1;\n",
        },
        { path: "unknown.txt", oldSource: "", newSource: "x" },
      ],
      testFilePatterns: VITEST_PATTERNS,
      sourcePathPattern: SOURCE_PATTERN,
    });
    expect(result.ok).toBe(false);
    expect(result.testFiles).toEqual(["packages/a/src/__tests__/x.vitest.ts"]);
    expect(result.exportOnlyEdits).toEqual(["packages/a/src/x.ts"]);
    expect(result.disallowed).toEqual(["unknown.txt"]);
  });
});

describe("diffIsExportKeywordsOnly", () => {
  test("returns false when line counts differ", () => {
    expect(diffIsExportKeywordsOnly("a\n", "a\nb\n")).toBe(false);
  });

  test("returns true when all changes are export-keyword additions", () => {
    expect(
      diffIsExportKeywordsOnly(
        "function a() {}\nasync function b() {}\nconst c = 1;\n",
        "export function a() {}\nexport async function b() {}\nexport const c = 1;\n",
      ),
    ).toBe(true);
  });

  test("returns false when a non-export change sneaks in", () => {
    expect(
      diffIsExportKeywordsOnly(
        "function a() {}\nconst b = 1;\n",
        "export function a() {}\nconst b = 2;\n",
      ),
    ).toBe(false);
  });

  test("preserves indentation", () => {
    expect(diffIsExportKeywordsOnly("  function a() {}\n", "  export function a() {}\n")).toBe(
      true,
    );
  });
});

describe("lineAddsExportKeyword", () => {
  test.each([
    ["const x = 1;", "export const x = 1;", true],
    ["function f() {}", "export function f() {}", true],
    ["async function f() {}", "export async function f() {}", true],
    ["class X {}", "export default class X {}", true],
    ["  const x = 1;", "  export const x = 1;", true],
    ["const x = 1;", "const y = 1;", false],
    ["  const x = 1;", "const x = 1;", false],
    ["const x = 1;", "const x = 1;", false],
  ])("%s → %s : %s", (oldLine, newLine, expected) => {
    expect(lineAddsExportKeyword(oldLine, newLine)).toBe(expected);
  });
});
