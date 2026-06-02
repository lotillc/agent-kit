import { describe, expect, test } from "vitest";

import { detectAntiPatternWarnings, VITEST_ANTI_PATTERN_WARNINGS } from "../runner/runVitest.js";

describe("detectAntiPatternWarnings", () => {
  test("catches the arrow-function constructor-mock warning (PR #2956 regression fence)", () => {
    // Regression fence: the agent shipped a test file with
    //   ResourceGroupsTaggingAPIClient: vi.fn().mockImplementation(() => ({...}))
    // which violates CLAUDE.md's "constructor mocks must be function or
    // class" rule and triggers a vitest v4 stderr warning. Tests passed,
    // exit 0, nothing caught it — PR shipped with broken mocks. The
    // validate gate now scans stderr for the exact warning vitest emits
    // and aborts the run so the reviewer/drop flow takes over.
    //
    // If vitest changes the wording of this warning, this test fails and
    // someone updates the regex in runVitest.ts (and re-runs a live
    // end-to-end to confirm the new string).
    const stderr = [
      "stderr | src/__tests__/audit-aws-resources.vitest.ts",
      "[vitest] The vi.fn() mock did not use 'function' or 'class' in its implementation,",
      " see https://vitest.dev/api/vi#vi-spyon for examples.",
    ].join("\n");

    const hits = detectAntiPatternWarnings(stderr);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toContain("vi.fn() mock did not use");
  });

  test("deduplicates repeated warnings (same pattern, many tests, one abort)", () => {
    // When a mock is hit by many test cases, vitest writes the same
    // warning dozens of times. The abort message must stay bounded.
    const stderr = Array(10)
      .fill("[vitest] The vi.fn() mock did not use 'function' or 'class'\n")
      .join("");
    expect(detectAntiPatternWarnings(stderr)).toHaveLength(1);
  });

  test("returns empty for clean stderr (happy path)", () => {
    expect(detectAntiPatternWarnings("")).toEqual([]);
    expect(detectAntiPatternWarnings("just some other log output")).toEqual([]);
  });

  test("VITEST_ANTI_PATTERN_WARNINGS includes the arrow-constructor-mock id", () => {
    // Downstream diagnostics key off the ID. Changing it requires a
    // coordinated edit here + in the abort log wiring.
    const ids = VITEST_ANTI_PATTERN_WARNINGS.map((w) => w.id);
    expect(ids).toContain("arrow-constructor-mock");
  });
});
