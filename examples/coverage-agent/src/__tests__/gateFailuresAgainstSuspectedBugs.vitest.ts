import { describe, expect, test } from "vitest";

import type { SuspectedBug } from "../artifacts/agentOutput.js";
import { gateFailuresAgainstSuspectedBugs } from "../commands/validate.js";
import type { VitestTestResult } from "../runner/runVitest.js";

function bug(testName: string): SuspectedBug {
  return {
    sourceRepoRel: "packages/alpha/src/foo.ts",
    testRepoRel: "packages/alpha/src/__tests__/foo.vitest.ts",
    testName,
    rationale: "source is buggy because …",
  };
}

function tr(name: string, passed: boolean): VitestTestResult {
  return { name, passed };
}

describe("gateFailuresAgainstSuspectedBugs", () => {
  test("OK: every failing test is declared AND every declaration corresponds to a failure", () => {
    const result = gateFailuresAgainstSuspectedBugs(
      [tr("returns empty for null (suspected bug: throws)", false), tr("handles happy path", true)],
      [bug("returns empty for null (suspected bug: throws)")],
    );
    expect(result).toEqual({ ok: true, expectedFailureCount: 1 });
  });

  test("OK: multiple declared suspected-bug tests all failing, unrelated tests pass", () => {
    const result = gateFailuresAgainstSuspectedBugs(
      [tr("bug A", false), tr("bug B", false), tr("happy path", true)],
      [bug("bug A"), bug("bug B")],
    );
    expect(result).toEqual({ ok: true, expectedFailureCount: 2 });
  });

  test("ABORT: vitest reported zero tests (import/compile error)", () => {
    // The json reporter may produce an empty testResults block when the
    // suite failed to load entirely. Treat that as abort — we do NOT want
    // to paper over a broken import with "oh just call it an expected
    // failure."
    const result = gateFailuresAgainstSuspectedBugs([], [bug("anything")]);
    expect(result).toEqual({
      ok: false,
      reason: "no structured test results from vitest JSON reporter",
    });
  });

  test("ABORT: non-zero exit but JSON reports zero failing tests", () => {
    const result = gateFailuresAgainstSuspectedBugs(
      [tr("happy path", true), tr("other", true)],
      [bug("anything")],
    );
    expect(result).toEqual({
      ok: false,
      reason: "vitest non-zero exit but JSON reports zero failing tests",
    });
  });

  test("ABORT: failing tests but no suspectedBugs entries at all", () => {
    const result = gateFailuresAgainstSuspectedBugs([tr("this was supposed to pass", false)], []);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("no suspectedBugs");
  });

  test("ABORT: undeclared failing test (agent lied / forgot to declare)", () => {
    // The whole point of the name-match gate is to prevent the agent from
    // getting a free pass through the validate gate by declaring ONE
    // suspected bug while actually shipping a suite full of unrelated
    // broken tests. Any undeclared failure kills the gate.
    const result = gateFailuresAgainstSuspectedBugs(
      [tr("declared bug", false), tr("surprise broken test", false)],
      [bug("declared bug")],
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("undeclared failing test");
    expect(result.reason).toContain("surprise broken test");
    // The abort hint must point the agent at the in-name marker.
    expect(result.reason).toContain("(suspected bug:");
  });

  test("ABORT: declared suspectedBugs entry that doesn't correspond to a failing test (liar entry)", () => {
    // A suspectedBugs entry naming a test that is NOT failing is a liar
    // entry — either the agent fabricated it or the test actually passes
    // (which would mean the source ISN'T buggy). Either way, reject.
    const result = gateFailuresAgainstSuspectedBugs(
      [tr("actually passing", true), tr("real failing test", false)],
      [bug("actually passing"), bug("real failing test")],
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("do not correspond to failing tests");
    expect(result.reason).toContain("actually passing");
  });

  test("ABORT: name mismatch between failing test and declaration (whitespace / typo)", () => {
    // Name matching is byte-exact. A one-space difference is enough to
    // reject. This is intentional: the agent is told the name must be
    // byte-identical. Fuzzy matching would open a surface for the agent
    // to declare "close enough" names and slip undeclared failures
    // through on a suffix match.
    const result = gateFailuresAgainstSuspectedBugs(
      [tr("returns empty for null", false)],
      [bug("returns empty  for null")], // two spaces
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("undeclared failing test");
  });
});
