import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  AgentOutputSchema,
  readAgentOutput,
  SuspectedBugSchema,
  writeAgentOutput,
} from "../artifacts/agentOutput.js";
import { renderPrBody } from "../pr/prBody.js";
import { buildTestGenerationPrompt } from "../prompts/buildTestGenerationPrompt.js";

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), "coverage-agent-bugs-")), "agent-output.json");
}

describe("SuspectedBug schema", () => {
  test("round-trips in agentOutput", () => {
    const path = tmpPath();
    const value = {
      status: "success" as const,
      filesCreated: ["packages/alpha/src/__tests__/foo.vitest.ts"],
      filesModified: [],
      rationale: "wrote 5 tests, 1 suspected bug",
      suspectedBugs: [
        {
          sourceRepoRel: "packages/alpha/src/foo.ts",
          testRepoRel: "packages/alpha/src/__tests__/foo.vitest.ts",
          testName: "returns empty for null (suspected bug: throws)",
          rationale: "Signature suggests T[]; currently throws TypeError",
        },
      ],
    };
    writeAgentOutput(path, value);
    expect(readAgentOutput(path)).toEqual(value);
  });

  test("suspectedBugs defaults to empty", () => {
    const parsed = AgentOutputSchema.parse({
      status: "success",
      rationale: "no suspicious behavior",
    });
    expect(parsed.suspectedBugs).toEqual([]);
  });

  test("rejects SuspectedBug missing rationale", () => {
    expect(() =>
      SuspectedBugSchema.parse({
        sourceRepoRel: "x.ts",
        testRepoRel: "x.vitest.ts",
        testName: "foo",
      }),
    ).toThrow();
  });
});

describe("renderPrBody — Suspected bugs section", () => {
  const baseInput = {
    packageName: "@loti/alpha",
    targets: [
      {
        relativeFilePath: "src/foo.ts",
        coverageBefore: { line: 0, branch: 0 },
        coverageAfter: { line: 50, branch: 50 },
        mutationBefore: null,
        mutationAfter: null,
      },
    ],
    stats: { tokensIn: 0, tokensOut: 0, totalCostUsd: 0 },
    workflowRunUrl: "",
  };

  test("omits section when no suspectedBugs", () => {
    const body = renderPrBody(baseInput);
    expect(body).not.toContain("## Suspected bugs found");
  });

  test("omits section for empty suspectedBugs array", () => {
    const body = renderPrBody({ ...baseInput, suspectedBugs: [] });
    expect(body).not.toContain("## Suspected bugs found");
  });

  test("renders singular framing for exactly 1", () => {
    const body = renderPrBody({
      ...baseInput,
      suspectedBugs: [
        {
          sourceRepoRel: "packages/alpha/src/foo.ts",
          testRepoRel: "packages/alpha/src/__tests__/foo.vitest.ts",
          testName: "returns empty for null",
          rationale: "Signature suggests T[]; currently throws",
        },
      ],
    });
    expect(body).toContain("## Suspected bugs found (CI is RED by design)");
    expect(body).toContain("1 bare failing `test(...)`");
    expect(body).toContain("CI is red on purpose");
    expect(body).toContain("- [ ] `foo.vitest.ts::returns empty for null`");
    expect(body).toContain("_Signature suggests T[]; currently throws_");
  });

  test("renders plural framing for multiple", () => {
    const body = renderPrBody({
      ...baseInput,
      suspectedBugs: [
        {
          sourceRepoRel: "a.ts",
          testRepoRel: "a.vitest.ts",
          testName: "t1",
          rationale: "r1",
        },
        {
          sourceRepoRel: "b.ts",
          testRepoRel: "b.vitest.ts",
          testName: "t2",
          rationale: "r2",
        },
      ],
    });
    expect(body).toContain("2 bare failing `test(...)` cases");
    expect(body).toContain("- [ ] `a.vitest.ts::t1`");
    expect(body).toContain("- [ ] `b.vitest.ts::t2`");
  });

  test("section warns against papering over the failure with .fails()/skip/delete", () => {
    // Regression fence: the prior copy told the human reviewer to "flip
    // .fails → bare test once the source is fixed" — but under the new
    // contract there is no .fails() wrapper to flip. The copy now must
    // steer toward fixing the source, not papering over the red test.
    const body = renderPrBody({
      ...baseInput,
      suspectedBugs: [
        {
          sourceRepoRel: "a.ts",
          testRepoRel: "a.vitest.ts",
          testName: "t1",
          rationale: "r1",
        },
      ],
    });
    expect(body).not.toContain("Flip `.fails` → bare `test`");
    expect(body).toContain("Do NOT convert these to `test.fails()`");
    expect(body).toContain("Fix the source instead.");
  });
});

describe("test-generation prompt includes the suspected-bug protocol", () => {
  test("bans test.fails() and requires a bare failing test with the (suspected bug: …) marker", () => {
    const prompt = buildTestGenerationPrompt({
      repoRoot: "/repo",
      packageName: "@loti/alpha",
      pnpmFilter: "@loti/alpha",
      targets: [{ repoRelativePath: "src/foo.ts", source: "export const x = 1;" }],
      maxTurns: 30,
      exemplars: [],
      testCommand: "pnpm --filter @loti/alpha exec vitest run /repo/a.vitest.ts",
    });
    expect(prompt).toContain("## Suspected-bug protocol");
    // The forbidden patterns must be explicitly named.
    expect(prompt).toContain("`test.fails()`");
    expect(prompt).toContain("FORBIDDEN");
    // The correct pattern must be explicit: bare test named with the marker.
    expect(prompt).toContain("bare `test(...)`");
    expect(prompt).toContain("(suspected bug:");
    expect(prompt).toContain('"suspectedBugs":');
    expect(prompt).toContain("Cap: no more than 3");
  });
});
