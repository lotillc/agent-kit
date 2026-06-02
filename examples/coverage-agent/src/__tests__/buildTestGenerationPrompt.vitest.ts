import { describe, expect, test } from "vitest";
import {
  buildTestGenerationPrompt,
  PROMPT_VERSION,
  type PromptTarget,
} from "../prompts/buildTestGenerationPrompt.js";
import { SUSPECTED_BUG_CONTRACT } from "../prompts/suspectedBugContract.js";

const singleTarget: PromptTarget = {
  repoRelativePath: "packages/alpha/src/foo.ts",
  source: "export function foo(x: number) { return x + 1; }\n",
};

const baseInput = {
  repoRoot: "/repo",
  packageName: "@loti/alpha",
  pnpmFilter: "@loti/alpha",
  targets: [singleTarget],
  maxTurns: 12,
  testCommand:
    "pnpm --filter @loti/alpha exec vitest run /repo/packages/alpha/src/__tests__/foo.vitest.ts",
};

describe("buildTestGenerationPrompt", () => {
  test("injects the caller-supplied testCommand verbatim into the workflow block", () => {
    const prompt = buildTestGenerationPrompt({
      ...baseInput,
      exemplars: [],
    });
    expect(prompt).toContain(
      "pnpm --filter @loti/alpha exec vitest run /repo/packages/alpha/src/__tests__/foo.vitest.ts",
    );
    expect(prompt).toContain("You have at most 12 agentic turns");
  });

  test("honors a different package-manager shape when the caller supplies one", () => {
    const prompt = buildTestGenerationPrompt({
      ...baseInput,
      exemplars: [],
      testCommand: "yarn workspace @loti/alpha vitest run /some/path.vitest.ts",
    });
    expect(prompt).toContain("yarn workspace @loti/alpha vitest run /some/path.vitest.ts");
    expect(prompt).not.toContain("pnpm --filter @loti/alpha");
  });

  test("N=1 keeps the pre-batching 'Target file:' heading", () => {
    const prompt = buildTestGenerationPrompt({ ...baseInput, exemplars: [] });
    expect(prompt).toContain("Target file: `packages/alpha/src/foo.ts`");
    expect(prompt).not.toContain("### Target 1 of");
  });

  test("injects the target source verbatim in a fenced block", () => {
    const prompt = buildTestGenerationPrompt({
      ...baseInput,
      exemplars: [],
    });
    expect(prompt).toContain("```ts\nexport function foo(x: number) { return x + 1; }\n\n```");
  });

  test("N>1 enumerates per-target blocks with ordinal headings", () => {
    const prompt = buildTestGenerationPrompt({
      ...baseInput,
      targets: [
        singleTarget,
        {
          repoRelativePath: "packages/alpha/src/bar.ts",
          source: "export const bar = 2;\n",
        },
        {
          repoRelativePath: "packages/alpha/src/baz.ts",
          source: "export const baz = 3;\n",
        },
      ],
      exemplars: [],
    });
    expect(prompt).toContain("### Target 1 of 3: `packages/alpha/src/foo.ts`");
    expect(prompt).toContain("### Target 2 of 3: `packages/alpha/src/bar.ts`");
    expect(prompt).toContain("### Target 3 of 3: `packages/alpha/src/baz.ts`");
    expect(prompt).toContain("3 specific TypeScript files");
    // Per-target quarantine instruction only appears for N>1.
    expect(prompt).toContain("Per-target quarantine");
    expect(prompt).toContain("silently drop that target");
  });

  test("N=1 does NOT include the per-target quarantine instruction", () => {
    const prompt = buildTestGenerationPrompt({ ...baseInput, exemplars: [] });
    expect(prompt).not.toContain("Per-target quarantine");
    expect(prompt).toContain("one specific file");
  });

  test("renders each exemplar as its own fenced section", () => {
    const prompt = buildTestGenerationPrompt({
      ...baseInput,
      exemplars: [
        {
          repoRelativePath: "packages/alpha/src/__tests__/bar.vitest.ts",
          source: "test bar here",
        },
        {
          repoRelativePath: "packages/alpha/src/__tests__/baz.vitest.ts",
          source: "test baz here",
        },
      ],
    });
    expect(prompt).toContain("### packages/alpha/src/__tests__/bar.vitest.ts");
    expect(prompt).toContain("test bar here");
    expect(prompt).toContain("### packages/alpha/src/__tests__/baz.vitest.ts");
    expect(prompt).toContain("test baz here");
  });

  test("renders a sentinel when exemplars are empty", () => {
    const prompt = buildTestGenerationPrompt({ ...baseInput, exemplars: [] });
    expect(prompt).toContain("_no exemplars available_");
  });

  test("replaces the agent-output path with the repo root", () => {
    const prompt = buildTestGenerationPrompt({ ...baseInput, exemplars: [] });
    expect(prompt).toContain("/repo/.coverage-agent-run/agent-output.json");
  });

  test("includes the env-setup block forbidding volta/PATH/install bootstrap", () => {
    const prompt = buildTestGenerationPrompt({ ...baseInput, exemplars: [] });
    expect(prompt).toContain("already set up");
    expect(prompt).toContain("VOLTA_HOME");
    expect(prompt).toContain("any dependency install command");
    expect(prompt).toContain("Run it verbatim");
  });

  test("omits the uncovered-lines block when no ranges are provided", () => {
    const prompt = buildTestGenerationPrompt({ ...baseInput, exemplars: [] });
    expect(prompt).not.toContain("Uncovered lines");
  });

  test("omits the uncovered-lines block when ranges array is empty", () => {
    const prompt = buildTestGenerationPrompt({
      ...baseInput,
      targets: [{ ...singleTarget, uncoveredRanges: [] }],
      exemplars: [],
    });
    expect(prompt).not.toContain("Uncovered lines");
  });

  test("renders the uncovered-lines block when ranges are provided on the target", () => {
    const prompt = buildTestGenerationPrompt({
      ...baseInput,
      targets: [
        {
          ...singleTarget,
          uncoveredRanges: [
            { start: 42, end: 45, type: "statement" },
            { start: 78, end: 78, type: "branch" },
            { start: 102, end: 110, type: "statement" },
          ],
        },
      ],
      exemplars: [],
    });
    expect(prompt).toContain("Uncovered lines");
    expect(prompt).toContain("zero coverage hits");
    expect(prompt).toContain("- Lines 42\u2013" + "45 (statements)");
    expect(prompt).toContain("- Line 78 (branches)");
    expect(prompt).toContain("- Lines 102\u2013" + "110 (statements)");
  });

  test("exports a stable PROMPT_VERSION identifier for run-record stamping", () => {
    expect(typeof PROMPT_VERSION).toBe("string");
    expect(PROMPT_VERSION.length).toBeGreaterThan(0);
  });

  test("embeds the shared SUSPECTED_BUG_CONTRACT in lockstep with fix-turn", () => {
    const prompt = buildTestGenerationPrompt({ ...baseInput, exemplars: [] });
    expect(prompt).toContain(SUSPECTED_BUG_CONTRACT);
  });

  test("Hard rules call out constructor-mock function/class requirement (PR #2956 regression fence)", () => {
    // Regression fence: PR #2956 shipped a test file with arrow-function
    // constructor mocks (vi.fn().mockImplementation(() => ({...})) for an
    // AWS client that the source `new`'s). Vitest v4 warned to stderr but
    // the pipeline didn't abort; the PR opened with broken-shape mocks.
    // The generation prompt must name the rule so the agent doesn't
    // default to arrow functions for class mocks. The validate gate
    // enforces at runtime via stderr detection (see
    // `runVitest.detectAntiPatternWarnings`), but prompt-level guidance
    // is what keeps the agent from producing the anti-pattern at all.
    const prompt = buildTestGenerationPrompt({ ...baseInput, exemplars: [] });
    // Hard rule is named.
    expect(prompt).toContain("Constructor mocks must be `function` or `class`");
    // The specific failure mode (vitest stderr warning + validate abort)
    // is named so the agent understands the consequence.
    expect(prompt).toContain("vitest 4 writes a stderr warning");
    expect(prompt).toContain("validate gate treats that warning as fatal");
    // Concrete examples: both the BAD arrow form and at least one GOOD
    // alternative. The class-based form is preferred per CLAUDE.md.
    expect(prompt).toContain("vi.fn().mockImplementation(() => ({ send: vi.fn() }))");
    expect(prompt).toContain("class MockDynamoDBClient");
    // Narrow the rule: plain function mocks (non-constructor) don't need
    // to change. Without this carve-out the agent might rewrite every
    // arrow-function mock in the tree.
    expect(prompt).toContain("Arrow functions are fine");
    expect(prompt).toContain("NEVER `new`'d");
  });

  test("Hard rules forbid conditional expect so anti-pattern lint failures are prevented at generation time", () => {
    const prompt = buildTestGenerationPrompt({ ...baseInput, exemplars: [] });
    expect(prompt).toContain("Never put `expect(...)` behind control flow");
    expect(prompt).toContain("`vitest/no-conditional-expect`");
    expect(prompt).toContain("split the scenarios into separate tests");
    expect(prompt).toContain("assert on it unconditionally");
  });

  test("Suspected-bug protocol is bare-failing-test, NOT test.fails()", () => {
    // Regression fence: PR #2950 shipped 4 `test.fails(...)` calls because
    // the generation prompt routed suspected bugs through `test.fails()`.
    // The new contract forbids `.fails()` and demands a bare failing
    // `test(...)`. Both signals must appear in the embedded protocol.
    const prompt = buildTestGenerationPrompt({ ...baseInput, exemplars: [] });
    expect(prompt).toContain("## Suspected-bug protocol");
    // The forbidden patterns must be named so the agent doesn't quietly
    // default back to them.
    expect(prompt).toContain("`test.fails()`");
    expect(prompt).toContain("FORBIDDEN");
    // And the right pattern must be named too: bare test with the marker.
    expect(prompt).toContain("bare `test(...)`");
    expect(prompt).toContain("(suspected bug:");
    expect(prompt).toContain("red test visible");
  });

  test("rejects an empty targets array", () => {
    expect(() =>
      buildTestGenerationPrompt({
        ...baseInput,
        targets: [],
        exemplars: [],
      }),
    ).toThrow(/targets\[\] must be non-empty/);
  });
});
