import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseUncoveredRanges } from "../selection/parseUncoveredRanges.js";

const TARGET_PATH = "/repo/packages/alpha/src/foo.ts";

function writeCoverageFinal(contents: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "coverage-agent-ranges-"));
  const path = join(dir, "coverage-final.json");
  writeFileSync(path, `${JSON.stringify(contents)}\n`, "utf8");
  return path;
}

// istanbul-lib-coverage's assertValidObject requires all of statementMap/s,
// fnMap/f, branchMap/b. Real coverage-final.json always has them; our
// fixtures default to empty maps so tests can override only what they need.
function fileCoverage(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    path: TARGET_PATH,
    statementMap: {},
    s: {},
    fnMap: {},
    f: {},
    branchMap: {},
    b: {},
    ...overrides,
  };
}

function stmt(
  startLine: number,
  endLine: number = startLine,
): {
  start: { line: number; column: number };
  end: { line: number; column: number };
} {
  return {
    start: { line: startLine, column: 0 },
    end: { line: endLine, column: 0 },
  };
}

describe("parseUncoveredRanges", () => {
  test("returns missing-file when coverage-final.json is absent", () => {
    expect(parseUncoveredRanges("/tmp/does-not-exist.json", TARGET_PATH)).toEqual({
      kind: "missing-file",
      coverageFinalPath: "/tmp/does-not-exist.json",
    });
  });

  test("returns parse-failed when JSON is malformed", () => {
    const dir = mkdtempSync(join(tmpdir(), "coverage-agent-ranges-"));
    const path = join(dir, "coverage-final.json");
    writeFileSync(path, "{ not valid", "utf8");
    const result = parseUncoveredRanges(path, TARGET_PATH);
    expect(result.kind).toBe("parse-failed");
    if (result.kind === "parse-failed") {
      expect(result.coverageFinalPath).toBe(path);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  test("returns target-not-in-summary when target file is absent", () => {
    const path = writeCoverageFinal({
      "/other/file.ts": fileCoverage({ path: "/other/file.ts" }),
    });
    const result = parseUncoveredRanges(path, TARGET_PATH);
    expect(result.kind).toBe("target-not-in-summary");
    if (result.kind === "target-not-in-summary") {
      expect(result.fileCount).toBe(1);
    }
  });

  test("extracts a single uncovered statement line", () => {
    const path = writeCoverageFinal({
      [TARGET_PATH]: fileCoverage({
        statementMap: { "0": stmt(10) },
        s: { "0": 0 },
      }),
    });
    expect(parseUncoveredRanges(path, TARGET_PATH)).toEqual({
      kind: "ok",
      ranges: [{ start: 10, end: 10, type: "statement" }],
    });
  });

  test("merges contiguous uncovered statement lines into one range", () => {
    const path = writeCoverageFinal({
      [TARGET_PATH]: fileCoverage({
        statementMap: {
          "0": stmt(42),
          "1": stmt(43),
          "2": stmt(44),
          "3": stmt(45),
        },
        s: { "0": 0, "1": 0, "2": 0, "3": 0 },
      }),
    });
    expect(parseUncoveredRanges(path, TARGET_PATH)).toEqual({
      kind: "ok",
      ranges: [{ start: 42, end: 45, type: "statement" }],
    });
  });

  test("ignores covered statements (hits > 0)", () => {
    const path = writeCoverageFinal({
      [TARGET_PATH]: fileCoverage({
        statementMap: { "0": stmt(10), "1": stmt(20), "2": stmt(30) },
        s: { "0": 3, "1": 0, "2": 7 },
      }),
    });
    expect(parseUncoveredRanges(path, TARGET_PATH)).toEqual({
      kind: "ok",
      ranges: [{ start: 20, end: 20, type: "statement" }],
    });
  });

  test("includes uncovered branches as a separate range type", () => {
    const path = writeCoverageFinal({
      [TARGET_PATH]: fileCoverage({
        branchMap: {
          "0": { loc: stmt(78), locations: [stmt(78), stmt(78)] },
        },
        b: { "0": [5, 0] },
      }),
    });
    expect(parseUncoveredRanges(path, TARGET_PATH)).toEqual({
      kind: "ok",
      ranges: [{ start: 78, end: 78, type: "branch" }],
    });
  });

  test("statements and branches coexist, sorted by start line", () => {
    const path = writeCoverageFinal({
      [TARGET_PATH]: fileCoverage({
        statementMap: {
          "0": stmt(102),
        },
        s: { "0": 0 },
        branchMap: {
          "0": { loc: stmt(78), locations: [stmt(78), stmt(78)] },
        },
        b: { "0": [3, 0] },
      }),
    });
    expect(parseUncoveredRanges(path, TARGET_PATH)).toEqual({
      kind: "ok",
      ranges: [
        { start: 78, end: 78, type: "branch" },
        { start: 102, end: 102, type: "statement" },
      ],
    });
  });

  test("skips branches where all arms are covered", () => {
    const path = writeCoverageFinal({
      [TARGET_PATH]: fileCoverage({
        branchMap: { "0": { loc: stmt(10), locations: [stmt(10), stmt(10)] } },
        b: { "0": [3, 5] },
      }),
    });
    expect(parseUncoveredRanges(path, TARGET_PATH)).toEqual({ kind: "ok", ranges: [] });
  });

  // Real coverage-final.json files (observed in this repo) contain implicit
  // branch arms emitted as fully empty `{ start: {}, end: {} }` location
  // objects — no `line` property at all. Earlier hand-rolled parsing rejected
  // these and dropped the whole file into `parse-failed`. `istanbul-lib-coverage`
  // handles them natively.
  test("silently handles branches with empty-object location arms", () => {
    const path = writeCoverageFinal({
      [TARGET_PATH]: fileCoverage({
        statementMap: { "0": stmt(10) },
        s: { "0": 0 },
        branchMap: {
          "0": {
            loc: stmt(85),
            locations: [stmt(85), { start: {}, end: {} }],
          },
        },
        b: { "0": [3, 0] },
      }),
    });
    expect(parseUncoveredRanges(path, TARGET_PATH)).toEqual({
      kind: "ok",
      ranges: [
        { start: 10, end: 10, type: "statement" },
        { start: 85, end: 85, type: "branch" },
      ],
    });
  });
});
