import { describe, expect, test } from "vitest";
import { buildFixPrompt } from "../commands/fixTurn.js";
import { SUSPECTED_BUG_CONTRACT } from "../prompts/suspectedBugContract.js";
import type { ReviewFinding } from "../review/reviewer.js";

describe("buildFixPrompt", () => {
  test("serializes findings into the prompt as JSON", () => {
    const findings: ReviewFinding[] = [
      {
        file: "packages/alpha/src/__tests__/foo.vitest.ts",
        line: 42,
        severity: "critical",
        issue: "mocks the module under test",
        suggestion: "assert on real output",
      },
    ];
    const prompt = buildFixPrompt(findings);
    expect(prompt).toContain("CRITICAL and HIGH severity findings");
    expect(prompt).toContain("packages/alpha/src/__tests__/foo.vitest.ts");
    expect(prompt).toContain('"severity": "critical"');
    expect(prompt).toContain('"suggestion": "assert on real output"');
  });

  test("includes hard rules about no source edits and no running tests", () => {
    const prompt = buildFixPrompt([]);
    expect(prompt).toContain("may NOT modify source files");
    expect(prompt).toContain("Do NOT run tests");
  });

  test("embeds the shared SUSPECTED_BUG_CONTRACT for recovery", () => {
    const prompt = buildFixPrompt([]);
    // Explicit instruction block naming the recoverable case.
    expect(prompt).toContain("your test asserts buggy behavior as if it were correct");
    // Full shared contract (keeps fix-turn + generation prompts in lockstep).
    expect(prompt).toContain(SUSPECTED_BUG_CONTRACT);
    // The declaration is the in-name marker; agent-output.json stays optional.
    expect(prompt).toContain("(suspected bug:");
    expect(prompt).toContain(".coverage-agent-run/agent-output.json");
  });

  test("hard-forbids test.fails()/it.fails() at the top of the Hard rules", () => {
    // Regression fence: PR #2950 shipped because the fix-turn prompt
    // allowed routing suspected bugs through `test.fails()`. The new
    // contract forbids it. Fix-turn must name the forbidden patterns AND
    // point at the anti-pattern lint gate so the agent knows why the
    // pipeline would reject them.
    const prompt = buildFixPrompt([]);
    expect(prompt).toContain("`test.fails()`");
    expect(prompt).toContain("FORBIDDEN");
    expect(prompt).toContain("anti-pattern lint gate");
  });

  test("explicitly warns that vitest globals are disabled so `test` must be imported", () => {
    // Regression fence: a real run had fix-turn add a bare `test(...)`
    // without adding `test` to the import list, causing `ReferenceError:
    // test is not defined` on re-validate and an `aborted_quality`
    // outcome. Both the Hard rules section AND the embedded
    // SUSPECTED_BUG_CONTRACT must loudly require the import.
    const prompt = buildFixPrompt([]);
    expect(prompt).toContain("Vitest globals are DISABLED");
    expect(prompt).toContain("ReferenceError: test is not defined");
    expect(prompt).toContain('import { ..., test } from "vitest"');
  });

  test("hard-forbids conditional expect and explains the rewrite shape", () => {
    const prompt = buildFixPrompt([]);
    expect(prompt).toContain("Conditional `expect(...)` is FORBIDDEN");
    expect(prompt).toContain("`vitest/no-conditional-expect`");
    expect(prompt).toContain("Split the branches into separate tests");
    expect(prompt).toContain("one unconditional assertion");
  });
});
