import type { ReviewInput } from "@lotiai/agent-kit/ports";

import { buildReviewerPrompt } from "./buildReviewerPrompt.js";

/**
 * Filename the adversarial reviewer agent writes to inside
 * `<workingDir>/.coverage-agent-run/`. Separate from the primary reviewer's
 * `review.json` so neither pass clobbers the other's artifact while the
 * orchestration in `runReview` is still capturing each result in-memory.
 */
export const ADVERSARIAL_REVIEW_JSON_BASENAME = "review.adversarial.json";

/**
 * Build the red-team 2nd-pass reviewer prompt. Wraps the primary prompt
 * (same rubric, same output schema) with an adversarial preamble that seeds
 * the "at least one bug-pin exists" hypothesis. The adversarial pass runs
 * concurrently with the primary — duplicate `(file, line, normalizedIssue)`
 * findings and severity upgrades are collapsed by `mergeReviewArtifacts`
 * (severity-max-wins, later-artifact-wording-wins), so this prompt no
 * longer threads primary findings to suppress duplicates.
 *
 * Defaults to the same model as the primary — this fixes a framing miss,
 * not a capability miss. `adversarialReviewerModel` is exposed for later
 * tuning.
 */
export function buildAdversarialReviewerPrompt(input: ReviewInput): string {
  const primaryPrompt = buildReviewerPrompt(input, {
    outputJsonBasename: ADVERSARIAL_REVIEW_JSON_BASENAME,
  });

  return `You are the **second reviewer** on this diff, running in red-team mode. A primary reviewer is reviewing the same diff in parallel; the merge step will collapse any findings you both raise at the same file+line (keeping the higher severity and your wording on ties).

## Working hypothesis

**The primary missed at least one test that pins a buggy source output as if it were correct.** This is the single most common AI-reviewer miss on this pipeline: the primary reads a test, notices the assertion matches the function's *actual* current output, and concludes the test is fine — without checking whether that output is itself correct. Your job is to catch the miss.

## How to hunt

For every test in the diff that asserts a specific return value or output shape:
1. Open the source file and read the function's intent from (a) its doc comment, (b) its sibling case branches, (c) any caller that consumes the return value.
2. Ask: would a reasonable reader agree the asserted value is the *correct* output, or merely the *current* output?
3. If the answer is "merely current" — flag it CRITICAL. Do NOT be dissuaded by "there's no consumer of the wrong value today" or "the function is used in isolation" — that reasoning let a real bug-pin ship to main in PR #2947 and we are explicitly fixing it here.

## Rules for your output

- **Flag every issue you see on the full rubric.** You don't have the primary's findings in front of you (parallel run); don't try to guess what they caught. The merge step will dedupe overlaps on \`(file, line, normalizedIssue)\`.
- **Severity-max-wins on same file+line.** If you flag something CRITICAL at a location where the primary only saw MEDIUM/LOW, the merge keeps CRITICAL and prefers your wording.
- **If you find nothing at all, return an empty findings array** with the summary string \`"no adversarial findings"\`. Do not invent findings to justify your run.
- **Apply the SAME rubric as the primary** (it is reproduced verbatim below). The only addition: tilt toward CRITICAL when in doubt on the "pins wrong output" axis — that is the whole reason you exist.

## Primary reviewer's full instructions (reproduce for consistency)

${primaryPrompt}
`;
}
