import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { readAgentOutput, writeAgentOutput } from "../artifacts/agentOutput.js";
import { readClaudeStats, writeClaudeStats } from "../artifacts/claudeStats.js";
import { readMetrics, writeMetrics } from "../artifacts/metrics.js";
import { readSelection, writeSelection } from "../artifacts/selection.js";

function tmpPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), "coverage-agent-art-")), name);
}

describe("selection artifact", () => {
  test("round-trips single-target (legacy fields mirror targets[0])", () => {
    const path = tmpPath("selection.json");
    const primary = {
      absoluteFilePath: "/repo/packages/alpha/src/foo.ts",
      relativeFilePath: "src/foo.ts",
      repoRelativeFilePath: "packages/alpha/src/foo.ts",
      uncoveredLines: 200,
      totalLines: 300,
      coverageBefore: { line: 33.3, branch: 50 },
    };
    const value = {
      packageName: "@loti/alpha",
      packageDir: "packages/alpha",
      targets: [primary],
      exemplarTestPaths: ["packages/alpha/src/__tests__/bar.vitest.ts"],
      locBudget: 1,
      ...primary,
    };
    writeSelection(path, value);
    expect(readSelection(path)).toEqual(value);
  });

  test("round-trips multi-target", () => {
    const path = tmpPath("selection.json");
    const primary = {
      absoluteFilePath: "/repo/packages/alpha/src/foo.ts",
      relativeFilePath: "src/foo.ts",
      repoRelativeFilePath: "packages/alpha/src/foo.ts",
      uncoveredLines: 200,
      totalLines: 300,
      coverageBefore: { line: 33.3, branch: 50 },
    };
    const second = {
      absoluteFilePath: "/repo/packages/alpha/src/bar.ts",
      relativeFilePath: "src/bar.ts",
      repoRelativeFilePath: "packages/alpha/src/bar.ts",
      uncoveredLines: 100,
      totalLines: 150,
      coverageBefore: { line: 0, branch: 0 },
    };
    const value = {
      packageName: "@loti/alpha",
      packageDir: "packages/alpha",
      targets: [primary, second],
      exemplarTestPaths: [],
      locBudget: 800,
      ...primary,
    };
    writeSelection(path, value);
    expect(readSelection(path)).toEqual(value);
  });
});

describe("claudeStats artifact", () => {
  test("round-trips with optional fields omitted", () => {
    const path = tmpPath("claude-stats.json");
    const value = { durationMs: 1234, success: true } as const;
    writeClaudeStats(path, value);
    expect(readClaudeStats(path)).toEqual(value);
  });

  test("preserves token counts", () => {
    const path = tmpPath("claude-stats.json");
    const value = {
      durationMs: 5000,
      totalCostUsd: 0.25,
      numTurns: 7,
      inputTokens: 1000,
      outputTokens: 400,
      cacheReadTokens: 500,
      cacheCreationTokens: 50,
      success: true,
    };
    writeClaudeStats(path, value);
    expect(readClaudeStats(path)).toEqual(value);
  });
});

describe("agentOutput artifact", () => {
  test("accepts status=success with files", () => {
    const path = tmpPath("agent-output.json");
    const value = {
      status: "success" as const,
      filesCreated: ["packages/alpha/src/__tests__/foo.vitest.ts"],
      filesModified: [],
      rationale: "wrote 4 tests covering happy and error paths",
      suspectedBugs: [],
    };
    writeAgentOutput(path, value);
    expect(readAgentOutput(path)).toEqual(value);
  });

  test("accepts status=gave_up", () => {
    const path = tmpPath("agent-output.json");
    const value = {
      status: "gave_up" as const,
      filesCreated: [],
      filesModified: [],
      rationale: "entire file is a constant object export",
      suspectedBugs: [],
    };
    writeAgentOutput(path, value);
    expect(readAgentOutput(path)).toEqual(value);
  });

  test("rejects invalid status", () => {
    expect(() =>
      writeAgentOutput(tmpPath("agent-output.json"), {
        status: "partial" as never,
        filesCreated: [],
        filesModified: [],
        rationale: "x",
        suspectedBugs: [],
      }),
    ).toThrow();
  });
});

describe("metrics artifact", () => {
  test("round-trips all fields", () => {
    const path = tmpPath("metrics.json");
    const value = {
      packageName: "@loti/alpha",
      targets: [
        {
          repoRelativeFilePath: "packages/alpha/src/foo.ts",
          relativeFilePath: "src/foo.ts",
          coverageBefore: { line: 0, branch: 0 },
          coverageAfter: { line: 85.2, branch: 70 },
          mutationBefore: 30,
          mutationAfter: 75,
        },
      ],
      iterations: 4,
      tokensIn: 1000,
      tokensOut: 500,
      costUsd: 0.12,
    };
    writeMetrics(path, value);
    expect(readMetrics(path)).toEqual(value);
  });

  test("accepts null mutation scores", () => {
    const path = tmpPath("metrics.json");
    const value = {
      packageName: "@loti/a",
      targets: [
        {
          repoRelativeFilePath: "a/b.ts",
          relativeFilePath: "b.ts",
          coverageBefore: { line: 0, branch: 0 },
          coverageAfter: { line: 50, branch: 50 },
          mutationBefore: null,
          mutationAfter: null,
        },
      ],
      iterations: 1,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    };
    writeMetrics(path, value);
    expect(readMetrics(path)).toEqual(value);
  });

  test("round-trips multi-target shape (N=2)", () => {
    const path = tmpPath("metrics.json");
    const value = {
      packageName: "@loti/alpha",
      targets: [
        {
          repoRelativeFilePath: "packages/alpha/src/a.ts",
          relativeFilePath: "src/a.ts",
          coverageBefore: { line: 0, branch: 0 },
          coverageAfter: { line: 80, branch: 60 },
          mutationBefore: null,
          mutationAfter: 70,
        },
        {
          repoRelativeFilePath: "packages/alpha/src/b.ts",
          relativeFilePath: "src/b.ts",
          coverageBefore: { line: 20, branch: 10 },
          coverageAfter: { line: 90, branch: 75 },
          mutationBefore: 30,
          mutationAfter: null,
        },
      ],
      iterations: 2,
      tokensIn: 500,
      tokensOut: 250,
      costUsd: 0.05,
    };
    writeMetrics(path, value);
    expect(readMetrics(path)).toEqual(value);
  });

  test("rejects empty targets[]", () => {
    expect(() =>
      writeMetrics(tmpPath("metrics.json"), {
        packageName: "@loti/alpha",
        targets: [],
        iterations: 0,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      }),
    ).toThrow();
  });
});
