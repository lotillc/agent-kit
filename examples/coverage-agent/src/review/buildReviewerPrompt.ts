import type { ReviewInput } from "@lotiai/agent-kit/ports";

const INSTRUCTIONS = `You are reviewing an AI-generated unit-test PR as a principal engineer. Read-only review. Your ONLY output is \`<REPO_ROOT>/.coverage-agent-run/<REVIEW_JSON_BASENAME>\`.

## Context
Target files under test (source → test):
<TARGET_BLOCK>

## The diff
\`\`\`diff
<DIFF_BLOCK>
\`\`\`

## What to look for (severity rubric)

CRITICAL — any of:
  - test asserts wrong behavior;
  - test mocks the module under test;
  - tests pass but wouldn't catch realistic bugs;
  - test body is tautological (\`expect(x).toBe(x)\`, \`expect(() => fn()).not.toThrow()\` as the only assertion);
  - **\`expect(...)\` appears inside control flow (\`if\`, \`else\`, \`switch\`, etc.).** The anti-pattern lint gate enforces \`vitest/no-conditional-expect\`, so this MUST be flagged CRITICAL. Suggestion: split branches into separate tests or compute a result first and make one unconditional assertion;
  - **use of \`test.fails()\` or \`it.fails()\`.** These are hard-forbidden by the anti-pattern lint gate and MUST be flagged CRITICAL if they slip through. The suggestion is: rewrite as a bare failing \`test(...)\` with the correct-behavior assertion and name it ending in \`(suspected bug: <reason>)\`. The pipeline treats a failing test whose name carries that marker as an expected-failure (validate gate lets it through and the PR opens visibly red so the source bug can't be ignored);
  - misuse of the suspected-bug marker — a test named \`(suspected bug: …)\` that does not actually fail, OR whose reason doesn't describe a plausible source bug;
  - **test pins factually incorrect function output as correct.** If the assertion describes what the function *actually* returns today but that return value is wrong (wrong shape, wrong token, wrong case, wrong delimiter — anything the source's own comments, sibling cases, or callers contradict), this is CRITICAL. Do NOT downgrade because "nothing consumes the wrong output today" or "there's no immediate downstream breakage" or "the function's local output matches what it returns" — this is CRITICAL regardless of downstream impact. A shipped test that pins wrong output WILL resist a future source fix and blesses future regressions — a test pinning buggy behavior is worse than no test. When you see this, flag CRITICAL and set the suggestion to: "Restore the correct-behavior assertion on a bare \`test(...)\` (no \`.fails()\` wrapper) and name it ending in \`(suspected bug: <reason>)\`. The test will fail CI by design — merge is blocked until the source is fixed."

HIGH — the test we shipped is actively wrong in a way short of CRITICAL: significant style drift from sibling tests in the same package that would mislead future authors; duplicate tests covering identical branches with different names; assertion that's weaker than the sibling tests' pattern for the same kind of branch (e.g. every other verify\\* test catches the rethrow path but this one doesn't — only HIGH if it's a pattern break, not just an absent test).

MEDIUM — non-obvious test naming; fixture complexity that will age badly; minor duplication; assertion that could be stronger.

LOW / INFO — **this is where "we should also test X" findings go.** "Missing a test for the rethrow path", "no test covers the Disabled state", "no edge-case test for null" — unless the *shipped* test is wrong, the absence of an additional test is at most LOW. Coverage completeness is gated separately by the coverage threshold; your job is to evaluate what was WRITTEN, not enumerate what was OMITTED. Do NOT raise a HIGH finding phrased as "test suite is missing X" — that is LOW.

**Exception — if the "missing test" you have in mind is for correct-behavior that the source code currently violates** (e.g. a source comment says "disabled keys are treated as gone" but the implementation silently returns true for them), that is not a "missing test" finding at all — it is CRITICAL: a latent source bug. Flag it CRITICAL and set the suggestion to "Add a bare failing \`test(...)\` asserting the correct behavior, named ending in \`(suspected bug: <reason>)\`." The pipeline treats marker-named failing tests as expected failures.

Do NOT use INFO, LOW, or MEDIUM for behavior the test pins incorrectly — that's CRITICAL regardless of downstream impact (see the CRITICAL rubric above). The "pins wrong output" severity is not negotiable based on whether a consumer exists today.

Prefer few sharp findings to many vague ones. If the tests look good, return an empty findings array. The bar for HIGH is "this test as-written is broken in a way that warrants a fix-turn"; "write more tests" is never HIGH.

## Output

Write to \`<REPO_ROOT>/.coverage-agent-run/<REVIEW_JSON_BASENAME>\`:

\`\`\`json
{
  "reviewerName": "claude",
  "durationMs": 0,
  "findings": [
    {
      "file": "packages/alpha/src/__tests__/foo.vitest.ts",
      "line": 42,
      "severity": "critical",
      "issue": "Test mocks the module under test",
      "suggestion": "Exercise the real implementation and assert on its output"
    }
  ],
  "summary": "one-sentence overall assessment"
}
\`\`\`

## Tools

You may Read any file, Grep, and run Bash(git \\*) to inspect history. You may NOT Write or Edit any file other than \`<REPO_ROOT>/.coverage-agent-run/<REVIEW_JSON_BASENAME>\`. You may NOT run tests or Stryker — the pipeline already does that.

You have at most <MAX_TURNS> agentic turns.
`;

export interface BuildReviewerPromptOptions {
  /**
   * Filename (not full path) the reviewer agent should write its JSON artifact
   * to, inside `<workingDir>/.coverage-agent-run/`. Defaults to `review.json`.
   * The adversarial 2nd-pass uses `review.adversarial.json` so it doesn't
   * clobber the primary's artifact on disk mid-run.
   */
  outputJsonBasename?: string;
}

export function buildReviewerPrompt(
  input: ReviewInput,
  opts: BuildReviewerPromptOptions = {},
): string {
  const targetBlock = input.targets
    .map((t) => `  - Source: \`${t.sourceRepoRel}\`\n    Test:   \`${t.testRepoRel}\``)
    .join("\n");
  const outputBasename = opts.outputJsonBasename ?? "review.json";
  return INSTRUCTIONS.replace(/<REPO_ROOT>/g, input.workingDir)
    .replace(/<REVIEW_JSON_BASENAME>/g, outputBasename)
    .replace("<TARGET_BLOCK>", targetBlock || "  (no targets — something is off)")
    .replace("<DIFF_BLOCK>", input.diff || "(empty diff)")
    .replace("<MAX_TURNS>", String(input.maxTurns));
}
