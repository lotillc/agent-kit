import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import * as invokeClaudeCommand from "../commands/invokeClaude.js";
import type { CoverageAgentConfig } from "../config.js";
import { testFileRelativePath, VitestConfig } from "../runner/testRunners.js";
import { invokeClaudeStep } from "../steps/invokeClaudeStep.js";

describe("testFileRelativePath — vitest mirrored layout", () => {
  test("top-level source maps to flat __tests__", () => {
    expect(testFileRelativePath("src/foo.ts", VitestConfig)).toBe("src/__tests__/foo.vitest.ts");
  });

  test("nested source preserves subdirectory layout", () => {
    expect(testFileRelativePath("src/nested/bar.ts", VitestConfig)).toBe(
      "src/__tests__/nested/bar.vitest.ts",
    );
  });

  test("deeply nested source preserves full path", () => {
    expect(testFileRelativePath("src/a/b/c/deep.ts", VitestConfig)).toBe(
      "src/__tests__/a/b/c/deep.vitest.ts",
    );
  });

  test("round-trips with the openPr quarantine regex", () => {
    // openPr.ts:121 uses /^(.*?)\/src\/__tests__\/(.+?)\.vitest\.ts$/ to turn
    // a produced test path back into its source path. If our forward mapping
    // matches the inverse, nested targets won't be falsely quarantined.
    const pkg = "packages/alpha";
    const relSource = "src/nested/bar.ts";
    const testRepoRel = `${pkg}/${testFileRelativePath(relSource, VitestConfig)}`;
    const m = testRepoRel.match(/^(.*?)\/src\/__tests__\/(.+?)\.vitest\.ts$/);
    expect(m).not.toBeNull();
    expect(`${m?.[1]}/src/${m?.[2]}.ts`).toBe(`${pkg}/${relSource}`);
  });

  test("sibling layout (jest-style) places test next to source", () => {
    const siblingConfig = { ...VitestConfig, testLayout: "sibling" as const };
    expect(testFileRelativePath("src/foo.ts", siblingConfig)).toBe("src/foo.vitest.ts");
    expect(testFileRelativePath("src/nested/bar.ts", siblingConfig)).toBe(
      "src/nested/bar.vitest.ts",
    );
  });
});

describe("installSignalCleanup", () => {
  function makeTarget(): NodeJS.EventEmitter {
    // EventEmitter satisfies on/off — good enough for a signal-source stub.
    return new EventEmitter();
  }

  test("runs cleanup once even if the signal fires twice", () => {
    const target = makeTarget();
    const cleanup = vi.fn();
    const exit = vi.fn();
    invokeClaudeCommand.installSignalCleanup(cleanup, target, exit);
    target.emit("SIGINT", "SIGINT");
    target.emit("SIGINT", "SIGINT");
    expect(cleanup).toHaveBeenCalledTimes(1);
    // exit also fires once — we short-circuit after the first handled signal.
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(130);
  });

  test("SIGTERM exits with code 143", () => {
    const target = makeTarget();
    const cleanup = vi.fn();
    const exit = vi.fn();
    invokeClaudeCommand.installSignalCleanup(cleanup, target, exit);
    target.emit("SIGTERM", "SIGTERM");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(143);
  });

  test("uninstall detaches the handler — later signals are ignored", () => {
    const target = makeTarget();
    const cleanup = vi.fn();
    const exit = vi.fn();
    const uninstall = invokeClaudeCommand.installSignalCleanup(cleanup, target, exit);
    uninstall();
    target.emit("SIGINT", "SIGINT");
    target.emit("SIGTERM", "SIGTERM");
    expect(cleanup).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  test("cleanup throwing does not block the exit call", () => {
    const target = makeTarget();
    const cleanup = vi.fn(() => {
      throw new Error("boom");
    });
    const exit = vi.fn();
    invokeClaudeCommand.installSignalCleanup(cleanup, target, exit);
    target.emit("SIGINT", "SIGINT");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(130);
  });
});

describe("invokeClaude stage/wrapper reuse", () => {
  test("runInvokeClaude maps a successful stage result to exit code 0", async () => {
    const config = { workingTree: "/repo", repoRoot: "/repo" } as never;
    const stage = vi.fn().mockResolvedValue({ success: true, config, isolated: false });

    await expect(invokeClaudeCommand.runInvokeClaude(config, stage)).resolves.toBe(0);
  });

  test("runInvokeClaude maps a failed stage result to exit code 1", async () => {
    const config = { workingTree: "/repo", repoRoot: "/repo" } as never;
    const stage = vi.fn().mockResolvedValue({ success: false, config, isolated: false });

    await expect(invokeClaudeCommand.runInvokeClaude(config, stage)).resolves.toBe(1);
  });

  test("invokeClaudeStep returns the reloaded config from the shared stage", async () => {
    const initialConfig = { workingTree: "/repo", repoRoot: "/repo" } as never;
    const reloadedConfig = { workingTree: "/tmp/wt", repoRoot: "/repo" } as never;
    vi.spyOn(invokeClaudeCommand, "invokeClaudeStage").mockResolvedValue({
      success: true,
      config: reloadedConfig,
      isolated: true,
    });

    await expect(invokeClaudeStep.run({ config: initialConfig })).resolves.toEqual({
      config: reloadedConfig,
    });
  });
});

describe("copyInvokeInputsToWorktree", () => {
  function makeConfig(repoRoot: string, workingTree: string = repoRoot): CoverageAgentConfig {
    return {
      repoRoot,
      workingTree,
      runOutputDir: resolve(workingTree, ".coverage-agent-run"),
      coverageSummaryPath: resolve(workingTree, "coverage/coverage-summary.json"),
      coverageFinalPath: resolve(workingTree, "coverage/coverage-final.json"),
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
      maxCostUsd: undefined,
      allowedBaseBranches: ["main", "coverage-agent/sandbox"],
      packageManager: {} as never,
      testRunner: VitestConfig,
      isSinglePackage: false,
    };
  }

  test("copies selection, stack base, and coverage artifacts into the isolated worktree", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "coverage-agent-invoke-"));
    const worktree = resolve(repoRoot, "wt");
    mkdirSync(resolve(repoRoot, ".coverage-agent-run"), { recursive: true });
    mkdirSync(resolve(repoRoot, "coverage"), { recursive: true });
    mkdirSync(resolve(worktree, "coverage"), { recursive: true });

    const initialConfig = makeConfig(repoRoot);
    const worktreeConfig = makeConfig(repoRoot, worktree);

    writeFileSync(initialConfig.selectionJsonPath, '{"targets":[]}\n', "utf8");
    writeFileSync(
      initialConfig.stackBasePath,
      '{"baseBranch":"main","baseRef":"main","baseSha":"abc1234","isStacked":false}\n',
      "utf8",
    );
    writeFileSync(initialConfig.coverageFinalPath, '{"result":"final"}\n', "utf8");
    writeFileSync(initialConfig.coverageSummaryPath, '{"result":"summary"}\n', "utf8");
    writeFileSync(initialConfig.strykerBeforeJsonPath, '{"mutationScore":80}\n', "utf8");

    invokeClaudeCommand.copyInvokeInputsToWorktree(initialConfig, worktreeConfig);

    expect(readFileSync(worktreeConfig.selectionJsonPath, "utf8")).toBe('{"targets":[]}\n');
    expect(readFileSync(worktreeConfig.stackBasePath, "utf8")).toContain('"baseSha":"abc1234"');
    expect(readFileSync(worktreeConfig.coverageFinalPath, "utf8")).toBe('{"result":"final"}\n');
    expect(readFileSync(worktreeConfig.coverageSummaryPath, "utf8")).toBe('{"result":"summary"}\n');
    expect(readFileSync(worktreeConfig.strykerBeforeJsonPath, "utf8")).toBe(
      '{"mutationScore":80}\n',
    );
  });

  test("skips stack-base copy when no artifact was written yet", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "coverage-agent-invoke-"));
    const worktree = resolve(repoRoot, "wt");
    mkdirSync(resolve(repoRoot, ".coverage-agent-run"), { recursive: true });

    const initialConfig = makeConfig(repoRoot);
    const worktreeConfig = makeConfig(repoRoot, worktree);

    writeFileSync(initialConfig.selectionJsonPath, '{"targets":[]}\n', "utf8");

    invokeClaudeCommand.copyInvokeInputsToWorktree(initialConfig, worktreeConfig);

    expect(existsSync(worktreeConfig.stackBasePath)).toBe(false);
  });

  test("skips stryker baseline copy when stryker-baseline did not run", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "coverage-agent-invoke-"));
    const worktree = resolve(repoRoot, "wt");
    mkdirSync(resolve(repoRoot, ".coverage-agent-run"), { recursive: true });

    const initialConfig = makeConfig(repoRoot);
    const worktreeConfig = makeConfig(repoRoot, worktree);

    writeFileSync(initialConfig.selectionJsonPath, '{"targets":[]}\n', "utf8");

    invokeClaudeCommand.copyInvokeInputsToWorktree(initialConfig, worktreeConfig);

    expect(existsSync(worktreeConfig.strykerBeforeJsonPath)).toBe(false);
  });
});
