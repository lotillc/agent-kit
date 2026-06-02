/**
 * The suspected-bug contract. Shared between the test-generation prompt (where
 * the agent may decide up-front to flag a source bug) and the fix-turn prompt
 * (where the agent recovers from a reviewer finding of "your test codifies a
 * bug as correct"). Keeping these in one string is the only way to guarantee
 * the two prompts describe the same shape — drift here silently breaks
 * recovery.
 *
 * Contract semantics (this is a deliberate reversal of the earlier
 * `test.fails()` approach):
 *
 * When the agent believes the source is buggy, it writes a **bare**
 * `test(...)` whose assertion describes the correct behavior and whose name
 * ends with the `(suspected bug: <reason>)` marker. The test genuinely fails
 * under CI. That failure is the signal — the PR opens red, merge is blocked
 * until the source is fixed. `test.fails()` / `it.fails()` are FORBIDDEN (the
 * anti-pattern lint gate rejects them) because they let a green-CI PR ship a
 * test that bless-codifies a source bug.
 *
 * The pipeline recognizes this pattern: a failing test whose name carries the
 * `(suspected bug: …)` marker is treated as an *expected* failure — it passes
 * the validate gate (coverage, stryker-skip, diff gate), but the red test
 * still ships so the PR is visibly broken until the source is fixed. The
 * marker IS the declaration; no separate `agent-output.json` edit is required.
 */
export const SUSPECTED_BUG_CONTRACT = `When you believe the source file has a bug, do NOT weaken the assertion and \`test.fails()\` / \`it.fails()\` are FORBIDDEN. Write a bare \`test(...)\` (or \`it(...)\`) whose assertion describes the **correct** behavior (what the source *should* do), and **name the test so it ends with \`(suspected bug: <one-line reason>)\`**. The test will genuinely fail under CI — that's the signal. The marker in the name IS the declaration: the pipeline derives it automatically, ships the PR with the red test visible, and blocks merge until the source is fixed.

## The name marker is the entire declaration

- End the failing test's name with \`(suspected bug: <reason>)\`. Example: \`test("returns [] for null input (suspected bug: throws TypeError)", ...)\`.
- \`<reason>\` is one short phrase explaining why the source is buggy.
- Only a **trailing** marker on a test that **genuinely fails** is recognized. A passing test carrying the marker is ignored. There is no separate file to edit and no string to keep byte-identical.

## Required: import \`test\` from vitest if you use \`test()\`

This repo runs Vitest with globals DISABLED, so every identifier you use must be imported explicitly. If the file you're editing already imports some of \`{ describe, it, expect }\` but not \`test\`, you MUST add \`test\` to that existing import statement — otherwise the file fails to load with \`ReferenceError: test is not defined\` and the pipeline aborts with \`aborted_quality\`.

## Hard prohibitions

- Do NOT use \`test.fails(...)\` or \`it.fails(...)\`. The anti-pattern lint gate rejects them; validation will fail before the PR opens.
- Do NOT use \`.skip()\`, \`.todo()\`, or \`// TODO\` comments to paper over the failure.
- Do NOT weaken the assertion to make the buggy current behavior pass (e.g., flipping \`expect(x).toBe("foo")\` to \`expect(x).toBe("foo:")\` to match a broken output).
- Do NOT wrap the assertion in \`expect(() => fn()).toThrow()\` just because the current buggy code happens to throw.

Concrete checklist before you save:

- [ ] The top of the test file contains the correct imports (e.g. \`import { describe, expect, test } from "vitest";\`).
- [ ] The failing test lives inside a \`describe\` block (or at top level), never dangling.
- [ ] The assertion describes **correct** behavior.
- [ ] The test's name ends with \`(suspected bug: <reason>)\`.

Example:

\`\`\`ts
// At the TOP of the file:
import { describe, expect, test } from "vitest";

// In the test body:

// BAD — weakens the assertion to pin buggy current output
test("returns empty array for null", () => {
  expect(fn(null)).toBe(null); // observed behavior, but that IS the bug
});

// BAD — uses test.fails (forbidden)
test.fails("returns empty array for null (suspected bug: throws TypeError)", () => {
  expect(fn(null)).toEqual([]);
});

// GOOD — bare test, correct assertion, marker in the name; fails until source fixed
test("returns empty array for null (suspected bug: throws TypeError)", () => {
  expect(fn(null)).toEqual([]);
});
\`\`\`

(Optional, legacy) You may additionally append an entry to \`suspectedBugs\` in \`agent-output.json\` — \`{ sourceRepoRel, testRepoRel, testName, rationale }\`, where \`testName\` is byte-identical to the \`test(...)\` title. If present it is honored, but the name marker alone is sufficient and preferred — there is nothing to keep in sync.

Cap: no more than 3 suspected-bug tests per target — more than that and something else is wrong; mark \`status: "gave_up"\` instead.`;
