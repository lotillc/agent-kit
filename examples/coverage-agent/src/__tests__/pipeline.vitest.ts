import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SpawnFn } from "@lotiai/agent-kit/ports";
import { describe, expect, test, vi } from "vitest";
import { COVERAGE_AGENT_PIPELINE, clearStaleWorktree } from "../commands/pipeline.js";
import type { CoverageAgentConfig } from "../config.js";
import { PnpmStrategy } from "../runner/packageManagers.js";
import { VitestConfig } from "../runner/testRunners.js";

function makeFakeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "coverage-agent-pipeline-"));
  mkdirSync(join(dir, ".coverage-agent-run"), { recursive: true });
  return dir;
}

function makeConfig(repoRoot: string, workingTree: string = repoRoot): CoverageAgentConfig {
  return {
    repoRoot,
    workingTree,
    runOutputDir: resolve(workingTree, ".coverage-agent-run"),
    coverageSummaryPath: resolve(workingTree, "coverage/coverage-summary.json"),
    selectionJsonPath: resolve(workingTree, ".coverage-agent-run/selection.json"),
    stackBasePath: resolve(workingTree, ".coverage-agent-run/stack-base.json"),
    claudeStatsPath: resolve(workingTree, ".coverage-agent-run/claude-stats.json"),
    fixTurnStatsPath: resolve(workingTree, ".coverage-agent-run/fix-turn-stats.json"),
    agentOutputPath: resolve(workingTree, ".coverage-agent-run/agent-output.json"),
    metricsPath: resolve(workingTree, ".coverage-agent-run/metrics.json"),
    runRecordPath: resolve(workingTree, ".coverage-agent-run/run-record.json"),
    strykerBeforeJsonPath: resolve(workingTree, ".coverage-agent-run/stryker-before.json"),
    strykerAfterJsonPath: resolve(workingTree, ".coverage-agent-run/stryker-after.json"),
    antiPatternLintConfigPath: resolve(workingTree, ".coverage-agent-run/eslint.gate.config.mjs"),
    worktreeMarkerPath: resolve(repoRoot, ".coverage-agent-run/.worktree"),
    sandboxBranch: "coverage-agent/sandbox",
    maxIterations: 3,
    flakeRuns: 5,
    maxClaudeTurns: 60,
    claudeTimeoutMs: 1_800_000,
    claudeModel: undefined,
    isolateMode: "auto",
    keepWorktree: false,
    shouldIsolate: true,
    dryRun: false,
    coverageRunLogPath: resolve(workingTree, ".coverage-agent-run/coverage-run.log"),
    reviewPath: resolve(workingTree, ".coverage-agent-run/review.json"),
    droppedFindingsPath: resolve(workingTree, ".coverage-agent-run/dropped-findings.json"),
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
    coverageFinalPath: resolve(workingTree, "coverage/coverage-final.json"),
    maxCostUsd: undefined,
    allowedBaseBranches: ["main", "coverage-agent/sandbox"],
    packageManager: PnpmStrategy,
    testRunner: VitestConfig,
    isSinglePackage: false,
  };
}

describe("clearStaleWorktree", () => {
  test("runs review-and-fix before validate so recoverable lint issues can be rewritten", () => {
    expect(COVERAGE_AGENT_PIPELINE.map((step) => step.name)).toEqual([
      "baseline",
      "select",
      "doctor",
      "dry-run-gate",
      "stryker-baseline",
      "invoke-claude",
      "review-and-fix",
      "validate",
      "open-pr",
    ]);
  });

  test("no-op when no marker is present", () => {
    const repo = makeFakeRepo();
    const config = makeConfig(repo);
    const reload = vi.fn(() => makeConfig(repo));
    const spawn = vi.fn(() => ({ stdout: "", stderr: "", exitCode: 0, signal: null }));

    const result = clearStaleWorktree(config, reload, spawn as unknown as SpawnFn);

    expect(result).toBe(config);
    expect(reload).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  test("unlinks marker and returns reloaded config when marker is present", () => {
    const repo = makeFakeRepo();
    const staleWorktree = "/tmp/coverage-agent-wt-stale";
    const config = makeConfig(repo, staleWorktree);
    writeFileSync(config.worktreeMarkerPath, `${staleWorktree}\n`, "utf8");

    const freshConfig = makeConfig(repo);
    const reload = vi.fn(() => freshConfig);
    const spawn = vi.fn(() => ({ stdout: "", stderr: "", exitCode: 0, signal: null }));

    const result = clearStaleWorktree(config, reload, spawn as unknown as SpawnFn);

    expect(existsSync(config.worktreeMarkerPath)).toBe(false);
    expect(spawn).toHaveBeenCalledWith(
      "git",
      ["worktree", "remove", "--force", staleWorktree],
      expect.objectContaining({ cwd: repo }),
    );
    expect(reload).toHaveBeenCalledOnce();
    expect(result).toBe(freshConfig);
    expect(result.workingTree).toBe(repo);
  });

  test("still unlinks marker when git worktree remove fails (path already gone)", () => {
    const repo = makeFakeRepo();
    const staleWorktree = "/tmp/coverage-agent-wt-already-gone";
    const config = makeConfig(repo, staleWorktree);
    writeFileSync(config.worktreeMarkerPath, `${staleWorktree}\n`, "utf8");

    const reload = vi.fn(() => makeConfig(repo));
    const spawn = vi.fn(() => ({
      stdout: "",
      stderr: "fatal: not a working tree",
      exitCode: 128,
      signal: null,
    }));

    clearStaleWorktree(config, reload, spawn as unknown as SpawnFn);

    // Marker is unlinked regardless of git exit code — matches
    // cleanupEphemeralWorktree's idempotency contract.
    expect(existsSync(config.worktreeMarkerPath)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });
});
