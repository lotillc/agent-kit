import { describe, expect, test } from "vitest";

import type { SuspectedBug } from "../artifacts/agentOutput.js";
import type { SelectionArtifact, SelectionTarget } from "../artifacts/selection.js";
import {
  collectTestFilesForValidation,
  deriveSuspectedBugsFromFailures,
  gateFailuresAgainstSuspectedBugs,
  unionSuspectedBugs,
} from "../commands/validate.js";
import type { VitestTestResult } from "../runner/runVitest.js";
import { VitestConfig } from "../runner/testRunners.js";

function tr(name: string, passed: boolean): VitestTestResult {
  return { name, passed };
}

function mkTarget(repoRelativeFilePath: string): SelectionTarget {
  return {
    absoluteFilePath: `/abs/${repoRelativeFilePath}`,
    relativeFilePath: repoRelativeFilePath,
    repoRelativeFilePath,
    uncoveredLines: 10,
    totalLines: 100,
    coverageBefore: { line: 0, branch: 0 },
  };
}

function mkSelection(targetPaths: string[]): SelectionArtifact {
  const targets = targetPaths.map(mkTarget);
  const first = targets[0];
  if (!first) throw new Error("mkSelection needs at least one target");
  return {
    packageName: "@loti/alpha",
    packageDir: "packages/alpha",
    targets,
    exemplarTestPaths: [],
    locBudget: 250,
    absoluteFilePath: first.absoluteFilePath,
    relativeFilePath: first.relativeFilePath,
    repoRelativeFilePath: first.repoRelativeFilePath,
    uncoveredLines: first.uncoveredLines,
    totalLines: first.totalLines,
    coverageBefore: first.coverageBefore,
  };
}

describe("collectTestFilesForValidation", () => {
  test("keeps created test files and excludes source edits", () => {
    expect(
      collectTestFilesForValidation(
        ["packages/a/src/__tests__/thing.vitest.ts", "packages/a/src/thing.ts"],
        VitestConfig.testFilePatterns,
      ),
    ).toEqual(["packages/a/src/__tests__/thing.vitest.ts"]);
  });

  test("keeps modified fixture files", () => {
    expect(
      collectTestFilesForValidation(
        ["packages/a/src/__tests__/fixtures/sample.fixture.ts"],
        VitestConfig.testFilePatterns,
      ),
    ).toEqual(["packages/a/src/__tests__/fixtures/sample.fixture.ts"]);
  });
});

describe("deriveSuspectedBugsFromFailures", () => {
  const testFile = "packages/alpha/src/__tests__/foo.vitest.ts";
  const selection = mkSelection(["packages/alpha/src/foo.ts"]);

  test("derives an entry from a failing marked test, inferring the source path", () => {
    const { derived, taintSafeSources } = deriveSuspectedBugsFromFailures(
      testFile,
      [tr("does X (suspected bug: returns wrong sign)", false), tr("happy path", true)],
      selection,
    );
    expect(derived).toEqual([
      {
        sourceRepoRel: "packages/alpha/src/foo.ts",
        testRepoRel: testFile,
        testName: "does X (suspected bug: returns wrong sign)",
        rationale: "returns wrong sign",
      },
    ]);
    expect(taintSafeSources).toEqual(["packages/alpha/src/foo.ts"]);
  });

  test("ignores a marked test that passes", () => {
    const { derived } = deriveSuspectedBugsFromFailures(
      testFile,
      [tr("does X (suspected bug: returns wrong sign)", true)],
      selection,
    );
    expect(derived).toEqual([]);
  });

  test("ignores a failing test with no marker", () => {
    const { derived } = deriveSuspectedBugsFromFailures(
      testFile,
      [tr("returns true when an unexpected error is thrown (safe default)", false)],
      selection,
    );
    expect(derived).toEqual([]);
  });

  test("single-target run trusts the selection over a wrong path inference", () => {
    // The test file's name-inverse (src/foo.ts) is NOT the selected nested
    // source. In a single-target run the selection is authoritative, so the
    // bug must be recorded against the real target and taint it for Stryker.
    const sel = mkSelection(["packages/alpha/src/deep/nested/foo.ts"]);
    const { derived, taintSafeSources } = deriveSuspectedBugsFromFailures(
      "packages/alpha/src/__tests__/foo.vitest.ts",
      [tr("does X (suspected bug: wrong sign)", false)],
      sel,
    );
    expect(derived[0]?.sourceRepoRel).toBe("packages/alpha/src/deep/nested/foo.ts");
    expect(taintSafeSources).toEqual(["packages/alpha/src/deep/nested/foo.ts"]);
  });

  test("N>1 run does not trust inference that matches no selected target", () => {
    // foo.vitest.ts infers src/foo.ts, which is not among the targets — we're
    // guessing, so the source is not taint-safe (Stryker still runs on it).
    const sel = mkSelection(["packages/alpha/src/deep/foo.ts", "packages/alpha/src/bar.ts"]);
    const { derived, taintSafeSources } = deriveSuspectedBugsFromFailures(
      "packages/alpha/src/__tests__/foo.vitest.ts",
      [tr("t (suspected bug: x)", false)],
      sel,
    );
    expect(derived).toHaveLength(1);
    expect(taintSafeSources).toEqual([]);
  });

  test("maps two files to their own inferred sources (N>1)", () => {
    const sel = mkSelection(["packages/alpha/src/foo.ts", "packages/alpha/src/bar.ts"]);
    const a = deriveSuspectedBugsFromFailures(
      "packages/alpha/src/__tests__/foo.vitest.ts",
      [tr("t1 (suspected bug: a)", false)],
      sel,
    );
    const b = deriveSuspectedBugsFromFailures(
      "packages/alpha/src/__tests__/bar.vitest.ts",
      [tr("t2 (suspected bug: b)", false)],
      sel,
    );
    expect(a.derived[0]?.sourceRepoRel).toBe("packages/alpha/src/foo.ts");
    expect(b.derived[0]?.sourceRepoRel).toBe("packages/alpha/src/bar.ts");
  });
});

describe("unionSuspectedBugs", () => {
  const explicit: SuspectedBug = {
    sourceRepoRel: "packages/alpha/src/foo.ts",
    testRepoRel: "packages/alpha/src/__tests__/foo.vitest.ts",
    testName: "t1 (suspected bug: x)",
    rationale: "explicit rationale",
  };

  test("dedups by (testRepoRel, testName), preferring the explicit entry", () => {
    const derived: SuspectedBug = { ...explicit, rationale: "auto-extracted" };
    expect(unionSuspectedBugs([explicit], [derived])).toEqual([explicit]);
  });

  test("keeps distinct entries", () => {
    const other: SuspectedBug = {
      sourceRepoRel: "packages/alpha/src/bar.ts",
      testRepoRel: "packages/alpha/src/__tests__/bar.vitest.ts",
      testName: "t2 (suspected bug: y)",
      rationale: "y",
    };
    expect(unionSuspectedBugs([explicit], [other])).toHaveLength(2);
  });
});

describe("marker derivation + gate (PR 4505 regression)", () => {
  const testFile = "packages/cli/src/__tests__/audit-aws-resources.vitest.ts";
  const selection = mkSelection(["packages/cli/src/audit-aws-resources.ts"]);

  test("a marker-named failing test passes the gate with NO explicit json entry", () => {
    const tests = [
      tr("returns true on unexpected error (suspected bug: rethrows instead)", false),
      tr("happy path", true),
    ];
    const { derived } = deriveSuspectedBugsFromFailures(testFile, tests, selection);
    const merged = unionSuspectedBugs([], derived);
    expect(gateFailuresAgainstSuspectedBugs(tests, merged)).toEqual({
      ok: true,
      expectedFailureCount: 1,
    });
  });

  test("the same failing test WITHOUT the marker still aborts, with a declare hint", () => {
    const tests = [tr("returns true when an unexpected error is thrown (safe default)", false)];
    const { derived } = deriveSuspectedBugsFromFailures(testFile, tests, selection);
    const merged = unionSuspectedBugs([], derived);
    const result = gateFailuresAgainstSuspectedBugs(tests, merged);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("(suspected bug:");
  });

  test("a marker test alongside an unmarked failing test still aborts", () => {
    const tests = [
      tr("real bug (suspected bug: off-by-one)", false),
      tr("accidentally broken test", false),
    ];
    const { derived } = deriveSuspectedBugsFromFailures(testFile, tests, selection);
    const merged = unionSuspectedBugs([], derived);
    const result = gateFailuresAgainstSuspectedBugs(tests, merged);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("undeclared failing test");
    expect(result.reason).toContain("accidentally broken test");
  });
});
