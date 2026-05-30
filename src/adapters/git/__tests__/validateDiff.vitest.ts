import { describe, expect, test, vi } from "vitest";

import type { SpawnFn, SpawnResult } from "../../../ports/SpawnFn.js";
import { validateWorkingTreeDiff } from "../validateDiff.js";

const VITEST_PATTERNS = [/\.vitest\.ts$/, /\/__tests__\//];
const SOURCE_PATTERN = /^packages\/.+\/src\/.+\.ts$/;

const ok = (stdout = ""): SpawnResult => ({ stdout, stderr: "", exitCode: 0, signal: null });

describe("validateWorkingTreeDiff", () => {
  test("collects changed files from both tracked and untracked, classifies each", () => {
    let call = 0;
    const spawn: SpawnFn = (_cmd, args) => {
      call += 1;
      // 1: diff -z --name-only
      if (args[0] === "diff" && args.includes("--name-only")) {
        return ok("packages/a/src/x.ts\0");
      }
      // 2: ls-files -z --others
      if (args[0] === "ls-files") {
        return ok("packages/a/src/__tests__/x.vitest.ts\0");
      }
      // git show <ref>:<path>
      if (args[0] === "show") {
        const arg = args[1] ?? "";
        if (arg.endsWith(":packages/a/src/x.ts")) return ok("const x = 1;\n");
        return ok("");
      }
      throw new Error(`unexpected call ${call}: ${args.join(" ")}`);
    };

    const readFile = vi.fn((abs: string) => {
      if (abs.endsWith("/packages/a/src/x.ts")) return "export const x = 1;\n";
      if (abs.endsWith("/packages/a/src/__tests__/x.vitest.ts")) return "test('x');";
      return "";
    });

    const result = validateWorkingTreeDiff({
      cwd: "/repo",
      baseRef: "HEAD",
      testFilePatterns: VITEST_PATTERNS,
      sourcePathPattern: SOURCE_PATTERN,
      spawn,
      readFile,
    });

    expect(result.ok).toBe(true);
    expect(result.testFiles).toContain("packages/a/src/__tests__/x.vitest.ts");
    expect(result.exportOnlyEdits).toContain("packages/a/src/x.ts");
    expect(result.disallowed).toEqual([]);
  });

  test("disallows source edits beyond export-keyword addition", () => {
    const spawn: SpawnFn = (_cmd, args) => {
      if (args[0] === "diff") return ok("packages/a/src/x.ts\0");
      if (args[0] === "ls-files") return ok("");
      if (args[0] === "show") return ok("const x = 1;\n");
      return ok("");
    };
    const readFile = () => "const x = 2;\n";

    const result = validateWorkingTreeDiff({
      cwd: "/repo",
      baseRef: "HEAD",
      testFilePatterns: VITEST_PATTERNS,
      sourcePathPattern: SOURCE_PATTERN,
      spawn,
      readFile,
    });

    expect(result.ok).toBe(false);
    expect(result.disallowed).toEqual(["packages/a/src/x.ts"]);
  });

  test("treats deleted files as empty new source", () => {
    const spawn: SpawnFn = (_cmd, args) => {
      if (args[0] === "diff") return ok("packages/a/src/x.ts\0");
      if (args[0] === "ls-files") return ok("");
      if (args[0] === "show") return ok("export const x = 1;\n");
      return ok("");
    };
    const readFile = () => {
      throw new Error("ENOENT");
    };

    const result = validateWorkingTreeDiff({
      cwd: "/repo",
      baseRef: "HEAD",
      testFilePatterns: VITEST_PATTERNS,
      sourcePathPattern: SOURCE_PATTERN,
      spawn,
      readFile,
    });

    // Deleted → new source is "" → line count mismatch → disallowed.
    expect(result.ok).toBe(false);
    expect(result.disallowed).toContain("packages/a/src/x.ts");
  });

  test("normalizes CRLF working tree against LF git blob (export-only still passes)", () => {
    // `git show <ref>:<path>` always returns LF; `readFileSync` on a CRLF
    // working tree (Windows or `core.autocrlf=true`) returns CRLF. Without
    // normalization every unchanged line would differ by trailing `\r` and a
    // valid export-only edit would be rejected.
    const spawn: SpawnFn = (_cmd, args) => {
      if (args[0] === "diff" && args.includes("--name-only")) {
        return ok("packages/a/src/x.ts\0");
      }
      if (args[0] === "ls-files") return ok("");
      if (args[0] === "show") return ok("const x = 1;\nconst y = 2;\n"); // LF
      return ok("");
    };
    // CRLF working-tree contents adding `export` keyword.
    const readFile = () => "export const x = 1;\r\nexport const y = 2;\r\n";

    const result = validateWorkingTreeDiff({
      cwd: "/repo",
      baseRef: "HEAD",
      testFilePatterns: VITEST_PATTERNS,
      sourcePathPattern: SOURCE_PATTERN,
      spawn,
      readFile,
    });

    expect(result.ok).toBe(true);
    expect(result.exportOnlyEdits).toEqual(["packages/a/src/x.ts"]);
    expect(result.disallowed).toEqual([]);
  });
});
