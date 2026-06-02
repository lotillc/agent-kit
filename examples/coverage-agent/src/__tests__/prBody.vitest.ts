import { describe, expect, test } from "vitest";
import type { PrBodyInput, PrBodyStats } from "../pr/prBody.js";
import { renderPrBody, renderPrTitle } from "../pr/prBody.js";

const emptyStats: PrBodyStats = {
  tokensIn: 0,
  tokensOut: 0,
  totalCostUsd: 0,
};

// Convenience wrapper: the legacy tests passed flat coverage/mutation
// fields to baseInput. Accept those shortcuts and splice them into the
// default target so existing assertions keep working without rewrite.
type LegacyTargetOverrides = {
  coverageBefore?: { line: number; branch: number };
  coverageAfter?: { line: number; branch: number };
  mutationBefore?: number | null;
  mutationAfter?: number | null;
};

function baseInput(overrides: Partial<PrBodyInput> & LegacyTargetOverrides = {}): PrBodyInput {
  const { coverageBefore, coverageAfter, mutationBefore, mutationAfter, ...rest } = overrides;
  const defaultTarget = {
    relativeFilePath: "src/foo.ts",
    coverageBefore: coverageBefore ?? { line: 0, branch: 0 },
    coverageAfter: coverageAfter ?? { line: 50, branch: 50 },
    mutationBefore: mutationBefore ?? null,
    mutationAfter: mutationAfter ?? null,
  };
  return {
    packageName: "@loti/alpha",
    targets: [defaultTarget],
    stats: emptyStats,
    workflowRunUrl: "",
    ...rest,
  };
}

describe("renderPrTitle", () => {
  test("formats package and path (single string)", () => {
    expect(renderPrTitle("@loti/alpha", "src/foo.ts")).toBe(
      "test(@loti/alpha): add coverage for src/foo.ts",
    );
  });

  test("N=1 array is formatted identically to a bare string", () => {
    expect(renderPrTitle("@loti/alpha", ["src/foo.ts"])).toBe(
      "test(@loti/alpha): add coverage for src/foo.ts",
    );
  });

  test("N>1 uses 'for N files' phrasing; filename list lives in the PR body", () => {
    expect(renderPrTitle("@loti/alpha", ["src/foo.ts", "src/bar.ts", "src/baz.ts"])).toBe(
      "test(@loti/alpha): add coverage for 3 files",
    );
  });

  test("dropped-only variant signals to humans that no tests shipped", () => {
    expect(renderPrTitle("@loti/alpha", "src/foo.ts", { droppedOnly: true })).toBe(
      "test(@loti/alpha): record reviewer-dropped coverage attempt for src/foo.ts",
    );
  });

  test("dropped-only batch variant uses 'for N files'", () => {
    expect(renderPrTitle("@loti/alpha", ["src/foo.ts", "src/bar.ts"], { droppedOnly: true })).toBe(
      "test(@loti/alpha): record reviewer-dropped coverage attempt for 2 files",
    );
  });
});

describe("renderPrBody", () => {
  test("renders deltas and run metadata", () => {
    const body = renderPrBody(
      baseInput({
        coverageBefore: { line: 40, branch: 30 },
        coverageAfter: { line: 70, branch: 50 },
        mutationBefore: 50,
        mutationAfter: 80,
        stats: {
          generationTurns: 2,
          tokensIn: 12345,
          tokensOut: 6789,
          totalCostUsd: 0.4321,
        },
        workflowRunUrl: "https://example.com/run/1",
      }),
    );
    expect(body).toContain("| Line coverage | 40.0% | 70.0% | +30.0 |");
    expect(body).toContain("| Branch coverage | 30.0% | 50.0% | +20.0 |");
    expect(body).toContain("| Mutation score | 50.0% | 80.0% | +30.0 |");
    expect(body).toContain("Generation turns: 2");
    expect(body).toContain("Cost: $0.4321");
    expect(body).toContain("https://example.com/run/1");
  });

  test("omits 'Generation turns' line when undefined (older/partial runs)", () => {
    // Regression fence: tokens-and-cost bug (pre-PR #2980) showed
    // "Iterations: 31/3" mashing invoke-claude's numTurns with an unrelated
    // pipeline-iteration cap. The fix replaced that with an optional
    // 'Generation turns' line — when generationTurns is absent the line
    // must simply not render rather than printing a misleading denominator.
    const body = renderPrBody(baseInput({ stats: emptyStats }));
    expect(body).not.toContain("Generation turns:");
    expect(body).not.toContain("Iterations:");
    expect(body).not.toMatch(/\/3\b/);
  });

  test("labels token count as 'incl. cache' so readers don't think it's bare inputTokens", () => {
    // Why this assertion: prior to the fix the PR body showed "Tokens: in 31"
    // on a 2-minute session — the 31 was bare inputTokens, excluding
    // cache-reads that account for ~99% of the footprint. That made the
    // PR summary look broken. The 'incl. cache' label is the shortest way
    // to tell a reviewer that the number is the real footprint.
    const body = renderPrBody(
      baseInput({
        stats: { ...emptyStats, tokensIn: 12_345_678, tokensOut: 18_871 },
      }),
    );
    expect(body).toContain("Tokens (incl. cache): in 12,345,678 / out 18,871");
  });

  test("appends per-phase cost breakdown when provided", () => {
    const body = renderPrBody(
      baseInput({
        stats: {
          ...emptyStats,
          totalCostUsd: 1.9807,
          costBreakdown: { generation: 0.882, review: 0.5573, fixTurn: 0.5414 },
        },
      }),
    );
    expect(body).toContain(
      "Cost: $1.9807 (generation $0.8820 + review $0.5573 + fix-turn $0.5414)",
    );
  });

  test("omits absent phases from the cost breakdown", () => {
    // When fix-turn didn't run, it shouldn't show up as $0.0000 — that
    // would imply it ran and was free.
    const body = renderPrBody(
      baseInput({
        stats: {
          ...emptyStats,
          totalCostUsd: 1.4393,
          costBreakdown: { generation: 0.882, review: 0.5573 },
        },
      }),
    );
    expect(body).toContain("Cost: $1.4393 (generation $0.8820 + review $0.5573)");
    expect(body).not.toContain("fix-turn");
  });

  test("renders plain Cost line with no breakdown suffix when breakdown absent", () => {
    const body = renderPrBody(baseInput({ stats: { ...emptyStats, totalCostUsd: 0.1 } }));
    expect(body).toContain("Cost: $0.1000");
    expect(body).not.toContain(" + ");
  });

  test("handles null mutation scores", () => {
    const body = renderPrBody(baseInput({ mutationBefore: null, mutationAfter: null }));
    expect(body).toContain("| Mutation score | — | — | — |");
  });

  test("N>1 renders one coverage table per target under its file heading", () => {
    const body = renderPrBody({
      packageName: "@loti/alpha",
      targets: [
        {
          relativeFilePath: "src/foo.ts",
          coverageBefore: { line: 10, branch: 5 },
          coverageAfter: { line: 80, branch: 60 },
          mutationBefore: null,
          mutationAfter: null,
        },
        {
          relativeFilePath: "src/bar.ts",
          coverageBefore: { line: 0, branch: 0 },
          coverageAfter: { line: 50, branch: 40 },
          mutationBefore: 40,
          mutationAfter: 70,
        },
      ],
      stats: emptyStats,
      workflowRunUrl: "",
    });
    // No singular "Target:" line — that's only N=1.
    expect(body).not.toMatch(/\*\*Target:\*\* `src\/foo\.ts`/);
    // Batch header.
    expect(body).toContain("covering 2 files in one run");
    // Per-target headings.
    expect(body).toContain("### `src/foo.ts`");
    expect(body).toContain("### `src/bar.ts`");
    // Both coverage tables present with distinct numbers.
    expect(body).toContain("| Line coverage | 10.0% | 80.0% | +70.0 |");
    expect(body).toContain("| Line coverage | 0.0% | 50.0% | +50.0 |");
    expect(body).toContain("| Mutation score | 40.0% | 70.0% | +30.0 |");
    // Stats section appears once, not per-target.
    expect(body.match(/Tokens \(incl\. cache\):/g)?.length).toBe(1);
    expect(body.match(/- Cost: \$/g)?.length).toBe(1);
  });

  test("N=1 PR body still uses the singular 'Target:' header (backward compat)", () => {
    const body = renderPrBody(baseInput());
    expect(body).toContain("**Target:** `src/foo.ts` (@loti/alpha)");
    expect(body).not.toContain("covering 1 files in one run");
  });

  test("rejects empty targets[]", () => {
    expect(() =>
      renderPrBody({
        packageName: "@loti/alpha",
        targets: [],
        stats: emptyStats,
        workflowRunUrl: "",
      }),
    ).toThrow(/targets\[\] must be non-empty/);
  });

  test("omits Reviewer findings section when no review provided", () => {
    const body = renderPrBody(baseInput());
    expect(body).not.toContain("## Reviewer findings");
  });

  test("renders Reviewer findings grouped by severity", () => {
    const body = renderPrBody(
      baseInput({
        review: {
          reviewerName: "claude",
          durationMs: 10000,
          findings: [
            {
              file: "packages/alpha/src/__tests__/foo.vitest.ts",
              severity: "critical",
              issue: "mocks the module under test",
            },
            {
              file: "packages/alpha/src/__tests__/foo.vitest.ts",
              line: 42,
              severity: "medium",
              issue: "fixture duplication",
              suggestion: "import from fixtures.ts",
            },
          ],
          summary: "one critical, one medium",
        },
      }),
    );
    expect(body).toContain("## Reviewer findings");
    expect(body).toContain("1 critical");
    expect(body).toContain("1 medium");
    expect(body).toContain("### critical (1)");
    expect(body).toContain("<summary>medium (1)</summary>");
    expect(body).toContain("mocks the module under test");
    expect(body).toContain("fixture duplication");
    expect(body).toContain("_Suggest: import from fixtures.ts_");
  });

  test("renders dropped tests section BEFORE reviewer findings when provided", () => {
    const body = renderPrBody(
      baseInput({
        coverageAfter: { line: 0, branch: 0 },
        review: {
          reviewerName: "claude",
          durationMs: 0,
          findings: [],
          summary: "clean (tests dropped)",
        },
        droppedTests: [
          {
            testRepoRel: "packages/alpha/src/__tests__/foo.vitest.ts",
            findings: [
              {
                file: "packages/alpha/src/__tests__/foo.vitest.ts",
                severity: "critical",
                issue: "codifies bug as correct",
                suggestion: "flip to test.fails()",
              },
            ],
          },
        ],
      }),
    );

    expect(body).toContain("## Tests dropped by reviewer");
    expect(body).toContain("`packages/alpha/src/__tests__/foo.vitest.ts`");
    expect(body).toContain("**critical (1)**");
    expect(body).toContain("codifies bug as correct");
    expect(body).toContain("_Suggest: flip to test.fails()_");
    expect(body).toContain("Quarantine-File:");
    expect(body.indexOf("## Tests dropped by reviewer")).toBeLessThan(
      body.indexOf("## Reviewer findings"),
    );
  });

  test("omits dropped tests section when none provided", () => {
    const body = renderPrBody(baseInput());
    expect(body).not.toContain("## Tests dropped by reviewer");
  });

  test("handles zero-finding review gracefully", () => {
    const body = renderPrBody(
      baseInput({
        review: {
          reviewerName: "claude",
          durationMs: 0,
          findings: [],
          summary: "clean",
        },
      }),
    );
    expect(body).toContain("## Reviewer findings");
    expect(body).toContain("0 critical, 0 high, 0 medium, 0 low, 0 info");
    expect(body).toContain("clean");
  });
});
