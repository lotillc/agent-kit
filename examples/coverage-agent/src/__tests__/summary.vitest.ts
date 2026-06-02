import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runSummary } from "../commands/summary.js";
import type { CoverageAgentConfig } from "../config.js";
import { PnpmStrategy } from "../runner/packageManagers.js";
import { VitestConfig } from "../runner/testRunners.js";

function makeConfig(dir: string): CoverageAgentConfig {
  return {
    repoRoot: dir,
    workingTree: dir,
    runOutputDir: dir,
    coverageSummaryPath: "",
    selectionJsonPath: "",
    stackBasePath: "",
    claudeStatsPath: join(dir, "claude-stats.json"),
    fixTurnStatsPath: join(dir, "fix-turn-stats.json"),
    agentOutputPath: "",
    metricsPath: "",
    runRecordPath: join(dir, "run-record.json"),
    strykerBeforeJsonPath: "",
    strykerAfterJsonPath: "",
    antiPatternLintConfigPath: "",
    worktreeMarkerPath: "",
    sandboxBranch: "coverage-agent/sandbox",
    maxIterations: 3,
    flakeRuns: 5,
    maxClaudeTurns: 60,
    claudeTimeoutMs: 1_200_000,
    claudeModel: undefined,
    isolateMode: "auto",
    keepWorktree: false,
    shouldIsolate: false,
    dryRun: false,
    coverageRunLogPath: "",
    reviewPath: "",
    droppedFindingsPath: join(dir, "dropped-findings.json"),
    reviewerNames: ["claude"],
    reviewerModel: undefined,
    enableAdversarialReview: true,
    adversarialReviewerModel: undefined,
    reviewMaxTurns: 8,
    fixMaxTurns: 10,
    locBudget: 800,
    maxFilesPerRun: 3,
    maxStackDepth: 3,
    upstreamRef: "origin/main",
    prLabel: "coverage-agent",
    workflowRunUrl: "",
    preflightScript: undefined,
    preflightTimeoutMs: 5 * 60 * 1000,
    claudeAuthMode: "auto",
    useBareAuth: false,
    coverageFinalPath: "",
    maxCostUsd: undefined,
    allowedBaseBranches: ["main", "coverage-agent/sandbox"],
    packageManager: PnpmStrategy,
    testRunner: VitestConfig,
    isSinglePackage: false,
  };
}

describe("runSummary", () => {
  let dir: string;
  let stepSummaryPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "coverage-agent-summary-"));
    stepSummaryPath = join(dir, "step-summary.md");
    vi.stubEnv("GITHUB_STEP_SUMMARY", stepSummaryPath);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("no-ops silently when neither artifact exists", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(runSummary(makeConfig(dir))).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });

  test("writes both sections to GITHUB_STEP_SUMMARY when both artifacts exist", () => {
    const config = makeConfig(dir);
    writeFileSync(
      config.runRecordPath,
      JSON.stringify({ outcome: "pr_opened", package: "@loti/example" }),
      "utf8",
    );
    writeFileSync(
      config.claudeStatsPath,
      JSON.stringify({ numTurns: 12, totalCostUsd: 0.42 }),
      "utf8",
    );

    expect(runSummary(config)).toBe(0);
    const contents = readFileSync(stepSummaryPath, "utf8");
    expect(contents).toContain("## Coverage Agent Run");
    expect(contents).toContain("### Run record");
    expect(contents).toContain('"outcome": "pr_opened"');
    expect(contents).toContain("### Claude stats");
    expect(contents).toContain('"numTurns": 12');
  });

  test("writes only run-record section when claude-stats is absent", () => {
    const config = makeConfig(dir);
    writeFileSync(config.runRecordPath, JSON.stringify({ outcome: "no_work" }), "utf8");

    expect(runSummary(config)).toBe(0);
    const contents = readFileSync(stepSummaryPath, "utf8");
    expect(contents).toContain("### Run record");
    expect(contents).not.toContain("### Claude stats");
  });

  test("falls back to stdout when GITHUB_STEP_SUMMARY is unset or empty", () => {
    // Stub to empty string (not unstub) — in CI the runner sets
    // GITHUB_STEP_SUMMARY before vitest boots, and vi.unstubAllEnvs() only
    // reverts our own stubs. The prod code treats "" as falsy (→ stdout)
    // via the `if (target)` truthy guard in summary.ts.
    vi.stubEnv("GITHUB_STEP_SUMMARY", "");
    const config = makeConfig(dir);
    writeFileSync(config.runRecordPath, JSON.stringify({ outcome: "dry_run" }), "utf8");
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    expect(runSummary(config)).toBe(0);
    const joined = write.mock.calls.map((c) => String(c[0])).join("");
    expect(joined).toContain("## Coverage Agent Run");
    expect(joined).toContain('"outcome": "dry_run"');
  });
});
