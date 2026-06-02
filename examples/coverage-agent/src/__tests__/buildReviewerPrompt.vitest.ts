import { describe, expect, test } from "vitest";
import { buildReviewerPrompt } from "../review/buildReviewerPrompt.js";

describe("buildReviewerPrompt", () => {
  test("injects working tree, targets, and diff", () => {
    const prompt = buildReviewerPrompt({
      diff: "diff --git a/foo\n+new line\n",
      targets: [
        {
          sourceRepoRel: "packages/alpha/src/foo.ts",
          testRepoRel: "packages/alpha/src/__tests__/foo.vitest.ts",
        },
      ],
      workingDir: "/tmp/repo",
      maxTurns: 8,
    });
    expect(prompt).toContain("/tmp/repo/.coverage-agent-run/review.json");
    expect(prompt).toContain("packages/alpha/src/foo.ts");
    expect(prompt).toContain("packages/alpha/src/__tests__/foo.vitest.ts");
    expect(prompt).toContain("diff --git a/foo");
    expect(prompt).toContain("at most 8 agentic turns");
  });

  test("handles empty targets with a sentinel line", () => {
    const prompt = buildReviewerPrompt({
      diff: "",
      targets: [],
      workingDir: "/tmp",
      maxTurns: 4,
    });
    expect(prompt).toContain("(no targets — something is off)");
    expect(prompt).toContain("(empty diff)");
  });

  test("rubric enumerates all severity levels", () => {
    const prompt = buildReviewerPrompt({
      diff: "x",
      targets: [],
      workingDir: "/",
      maxTurns: 1,
    });
    expect(prompt).toContain("CRITICAL");
    expect(prompt).toContain("HIGH");
    expect(prompt).toContain("MEDIUM");
    expect(prompt).toContain("LOW");
    expect(prompt).toContain("INFO");
  });

  test("CRITICAL rubric names the 'correct in isolation but latent bug' case and routes it to bare failing test + suspected-bug marker", () => {
    // Regression fence: this prompt change exists because a real PR
    // (lotillc/loti-interchange-monorepo#2944) shipped a test that pinned
    // an end-to-end source bug as correct — the reviewer downgraded it to
    // `info` and fix-turn never ran. The rubric must (a) classify this
    // pattern as CRITICAL and (b) steer the fix toward the
    // bare-failing-test contract (NOT test.fails(), which the new
    // anti-pattern lint gate forbids).
    const prompt = buildReviewerPrompt({
      diff: "x",
      targets: [],
      workingDir: "/",
      maxTurns: 1,
    });
    expect(prompt).toContain("pins factually incorrect function output");
    expect(prompt).toContain("(suspected bug:");
    // The suggested fix must route to the bare-failing-test contract.
    expect(prompt).toContain("bare `test(...)`");
    expect(prompt).toContain("merge is blocked until the source is fixed");
    // And the INFO rubric must explicitly forbid this downgrade.
    expect(prompt).toContain(
      "Do NOT use INFO, LOW, or MEDIUM for behavior the test pins incorrectly",
    );
  });

  test("CRITICAL rubric hard-forbids test.fails()/it.fails() in diffs", () => {
    // Regression fence for PR #2950: the agent was routing suspected
    // bugs through `test.fails()` and the reviewer was (correctly) not
    // flagging them as critical because the old rubric allowed the
    // pattern. The new rubric must name `.fails()` as CRITICAL and point
    // the fix at a bare failing test.
    const prompt = buildReviewerPrompt({
      diff: "x",
      targets: [],
      workingDir: "/",
      maxTurns: 1,
    });
    expect(prompt).toContain("`test.fails()` or `it.fails()`");
    expect(prompt).toContain("hard-forbidden by the anti-pattern lint gate");
    // Must name the expected-failure flow so the reviewer knows why the
    // bare-failing pattern is OK and the wrapped pattern isn't.
    expect(prompt).toContain("expected-failure");
  });

  test("CRITICAL rubric flags conditional expect as anti-pattern-lint-breaking", () => {
    const prompt = buildReviewerPrompt({
      diff: "x",
      targets: [],
      workingDir: "/",
      maxTurns: 1,
    });
    expect(prompt).toContain("inside control flow");
    expect(prompt).toContain("`vitest/no-conditional-expect`");
    expect(prompt).toContain("split branches into separate tests");
    expect(prompt).toContain("one unconditional assertion");
  });

  test("outputJsonBasename option routes the reviewer's write path (used by adversarial pass to avoid clobber)", () => {
    // The adversarial 2nd-pass reviewer must write to a distinct filename so
    // that if both passes ever race on disk, neither overwrites the other's
    // JSON before the orchestrator reads it. Without this option, both passes
    // would share `review.json` and whichever flushed last would win.
    const defaultPrompt = buildReviewerPrompt({
      diff: "x",
      targets: [],
      workingDir: "/tmp/repo",
      maxTurns: 1,
    });
    const alt = buildReviewerPrompt(
      {
        diff: "x",
        targets: [],
        workingDir: "/tmp/repo",
        maxTurns: 1,
      },
      { outputJsonBasename: "review.adversarial.json" },
    );
    expect(defaultPrompt).toContain("/tmp/repo/.coverage-agent-run/review.json");
    expect(defaultPrompt).not.toContain("review.adversarial.json");
    expect(alt).toContain("/tmp/repo/.coverage-agent-run/review.adversarial.json");
    expect(alt).not.toMatch(/\/\.coverage-agent-run\/review\.json\b/);
  });

  test("'missing test for X' is explicitly LOW/INFO, not HIGH (PR #2955 regression fence)", () => {
    // Regression fence for PR #2955: the reviewer raised three HIGH
    // findings all phrased "test suite is missing X" (rethrow path, KMS
    // Disabled state), which caused the entire test file to be dropped
    // — including a correctly-structured bare failing `test(...)` for
    // a real source bug. The rubric must explicitly route "missing test"
    // findings to LOW/INFO so they don't tank the PR.
    const prompt = buildReviewerPrompt({
      diff: "x",
      targets: [],
      workingDir: "/",
      maxTurns: 1,
    });
    // The LOW/INFO bullet must explicitly claim "missing test" findings.
    expect(prompt).toContain('"we should also test X"');
    expect(prompt).toContain("Coverage completeness is gated separately");
    expect(prompt).toContain('Do NOT raise a HIGH finding phrased as "test suite is missing X"');
    // The reinforcing floor at the bottom must restate this.
    expect(prompt).toContain('"write more tests" is never HIGH');
  });

  test("'missing test whose correct behavior the source violates' routes to CRITICAL + suspected-bug marker", () => {
    // Regression fence for PR #2955: finding #3 was a real latent source
    // bug (KMS source comment says "disabled = gone" but code returns
    // true for disabled keys). It was phrased "missing a test for
    // Disabled state" and scored HIGH, so it drowned in the drop flow.
    // The rubric must name this case as an EXCEPTION to the LOW/INFO
    // floor for missing-test findings — it's a latent bug and must be
    // CRITICAL + routed to the suspectedBugs flow.
    const prompt = buildReviewerPrompt({
      diff: "x",
      targets: [],
      workingDir: "/",
      maxTurns: 1,
    });
    expect(prompt).toContain("Exception");
    expect(prompt).toContain("source code currently violates");
    expect(prompt).toContain("latent source bug");
    // Must route to the bare-failing-test contract (same as the other
    // CRITICAL sub-case).
    expect(prompt).toContain("(suspected bug:");
    expect(prompt).toContain("bare failing `test(...)`");
  });

  test("CRITICAL rubric drops the 'misused downstream' loophole that let PR #2947 ship a bug-pinning it()", () => {
    // Regression fence: our prior rubric phrased the CRITICAL bullet as
    // "the function's return value is misused downstream," which the
    // reviewer in PR #2947 honestly read as "no downstream consumer, so
    // not critical" for an extractResourceType bug-pin on a Secrets
    // Manager ARN. It shipped as `it(...)` instead of `test.fails(...)`.
    // The new rubric MUST be unconditional on downstream impact.
    const prompt = buildReviewerPrompt({
      diff: "x",
      targets: [],
      workingDir: "/",
      maxTurns: 1,
    });
    // The specific loophole phrasing must be gone.
    expect(prompt).not.toContain("misused downstream");
    expect(prompt).not.toContain("implicitly blesses broken end-to-end");
    // And the reinforcement "regardless of downstream" must appear in
    // both the CRITICAL bullet and the INFO floor. This is how we
    // shut the loophole.
    expect(prompt).toContain("CRITICAL regardless of downstream impact");
    expect(prompt).toContain("regardless of downstream impact");
    expect(prompt).toContain("no immediate downstream breakage");
    expect(prompt).toContain("pinning buggy behavior is worse than no test");
  });
});
