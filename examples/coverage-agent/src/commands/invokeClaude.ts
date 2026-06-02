import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { listOpenPrs } from "@lotiai/agent-kit/gh-cli";
import { preflightWorktree, removeWorktree, removeWorktreeMarker } from "@lotiai/agent-kit/git";
import type { SpawnFn } from "@lotiai/agent-kit/ports";
import { defaultSpawn } from "@lotiai/agent-kit/process";
import { createWorktreeStepRun, runClaudeStepRun } from "@lotiai/agent-kit/steps";

import { readAgentOutput } from "../artifacts/agentOutput.js";
import { writeClaudeStats } from "../artifacts/claudeStats.js";
import { readSelection } from "../artifacts/selection.js";
import { writeStackBase } from "../artifacts/stackBase.js";
import type { CoverageAgentConfig } from "../config.js";
import { loadConfig } from "../config.js";
import {
  buildTestGenerationPrompt,
  type PromptExemplar,
  type PromptTarget,
} from "../prompts/buildTestGenerationPrompt.js";
import { renderCommand } from "../runner/packageManagers.js";
import { testFileRelativePath as testFileRelativePathFromRunner } from "../runner/testRunners.js";
import { parseUncoveredRanges } from "../selection/parseUncoveredRanges.js";
import { resolveStackBaseForRun } from "../stack/resolveStackBaseForRun.js";

export interface InvokeClaudeStageResult {
  success: boolean;
  config: CoverageAgentConfig;
  isolated: boolean;
}

export async function invokeClaudeStage(
  initialConfig: CoverageAgentConfig = loadConfig(),
): Promise<InvokeClaudeStageResult> {
  if (!existsSync(initialConfig.selectionJsonPath)) {
    process.stderr.write(`selection.json not found at ${initialConfig.selectionJsonPath}\n`);
    return { success: false, config: initialConfig, isolated: false };
  }
  mkdirSync(initialConfig.runOutputDir, { recursive: true });

  const selection = readSelection(initialConfig.selectionJsonPath);

  // Create an isolated worktree from the stack base, not the feature branch
  // head, so stacked PRs include only agent-authored commits.
  let config = initialConfig;
  let isolated = false;
  if (initialConfig.shouldIsolate && initialConfig.workingTree === initialConfig.repoRoot) {
    const openPrs = listOpenPrs({
      cwd: initialConfig.repoRoot,
      label: initialConfig.prLabel,
    });
    const stackBase = resolveStackBaseForRun({
      repoRoot: initialConfig.repoRoot,
      sandboxBranch: initialConfig.sandboxBranch,
      openPrs,
      spawn: defaultSpawn,
    });
    // `runOutputDir` was already ensured above; just persist the artifact.
    writeStackBase(initialConfig.stackBasePath, stackBase);
    process.stderr.write(
      `[invoke-claude] stack base: ${stackBase.baseBranch} @ ${stackBase.baseSha.slice(0, 7)} ` +
        `(stacked=${stackBase.isStacked})\n`,
    );
    const { _toolkit_worktreePath: worktreePath } = createWorktreeStepRun({
      repoRoot: initialConfig.repoRoot,
      baseRef: stackBase.baseSha,
    });
    writeFileSync(initialConfig.worktreeMarkerPath, `${worktreePath}\n`, "utf8");
    process.stderr.write(
      `[invoke-claude] isolated worktree: ${worktreePath} (detached from ${stackBase.baseSha.slice(0, 7)})\n`,
    );
    // Re-resolve paths against the worktree.
    config = loadConfig();
    copyInvokeInputsToWorktree(initialConfig, config);
    isolated = true;

    // Preflight the worktree so Claude doesn't spend turns on setup.
    const strategy = config.preflightScript ? "preflight-script" : "pnpm-install";
    process.stderr.write(`[invoke-claude:preflight] strategy=${strategy}\n`);
    try {
      // Call the adapter directly so we can pass `timeoutMs`.
      const result = preflightWorktree({
        worktreePath,
        strategy,
        scriptPath: config.preflightScript,
        timeoutMs: config.preflightTimeoutMs,
      });
      if (!result.ok) {
        throw new Error(`preflight failed (${result.strategy}): ${result.error ?? "unknown"}`);
      }
      process.stderr.write(`[invoke-claude:preflight] ${strategy} ok\n`);
    } catch (err) {
      process.stderr.write(`[invoke-claude:preflight] ${(err as Error).message}\n`);
      cleanupEphemeralWorktree(
        initialConfig.repoRoot,
        worktreePath,
        initialConfig.worktreeMarkerPath,
        config.keepWorktree,
      );
      return { success: false, config, isolated };
    }
  }

  // Failure paths must tear down the worktree unless explicitly kept.
  const cleanupOnFail = (): void => {
    if (!isolated) return;
    cleanupEphemeralWorktree(
      initialConfig.repoRoot,
      config.workingTree,
      initialConfig.worktreeMarkerPath,
      config.keepWorktree,
    );
    if (!config.keepWorktree) {
      process.stderr.write(`[invoke-claude] removed ephemeral worktree ${config.workingTree}\n`);
    }
  };

  // Clean up on SIGINT/SIGTERM so interrupted runs do not orphan worktrees.
  const uninstallSignalCleanup = isolated ? installSignalCleanup(cleanupOnFail) : () => {};

  try {
    // Build prompt inputs from the selected targets. Skip unreadable files.
    const promptTargets: PromptTarget[] = [];
    for (const t of selection.targets) {
      const absPath = resolve(config.workingTree, t.repoRelativeFilePath);
      if (!existsSync(absPath)) {
        process.stderr.write(
          `[invoke-claude] skipping target ${t.repoRelativeFilePath} — file not found in worktree\n`,
        );
        continue;
      }
      const source = readFileSync(absPath, "utf8");
      const parseResult = parseUncoveredRanges(config.coverageFinalPath, absPath);
      const uncoveredRanges = parseResult.kind === "ok" ? parseResult.ranges : [];
      if (parseResult.kind === "ok" && parseResult.ranges.length > 0) {
        process.stderr.write(
          `[invoke-claude] ${t.repoRelativeFilePath}: ${parseResult.ranges.length} uncovered range hint(s)\n`,
        );
      } else if (parseResult.kind === "missing-file") {
        process.stderr.write(
          `[invoke-claude] coverage-final.json not found at ${parseResult.coverageFinalPath} — skipping uncovered-range hints.\n`,
        );
      } else if (parseResult.kind === "parse-failed") {
        process.stderr.write(
          `[invoke-claude] coverage-final.json failed to parse (${parseResult.message}) — skipping uncovered-range hints.\n`,
        );
      } else if (parseResult.kind === "target-not-in-summary") {
        process.stderr.write(
          `[invoke-claude] ${t.repoRelativeFilePath}: not in coverage-final.json (${parseResult.fileCount} files) — skipping hints for this target.\n`,
        );
      }
      promptTargets.push({
        repoRelativePath: t.repoRelativeFilePath,
        source,
        uncoveredRanges,
      });
    }
    if (promptTargets.length === 0) {
      process.stderr.write("[invoke-claude] no readable targets in selection; aborting\n");
      cleanupOnFail();
      return { success: false, config, isolated };
    }

    const exemplars: PromptExemplar[] = [];
    for (const relPath of selection.exemplarTestPaths) {
      const abs = resolve(config.workingTree, relPath);
      if (!existsSync(abs)) continue;
      exemplars.push({ repoRelativePath: relPath, source: readFileSync(abs, "utf8") });
    }

    // Seed the prompt with the primary target's test command.
    const primaryTestFile = resolve(
      config.workingTree,
      selection.packageDir,
      testFileRelativePathFromRunner(selection.relativeFilePath, config.testRunner),
    );
    const testCommand = renderCommand(
      config.packageManager.runTestInPackage({
        pkgFilter: selection.packageName,
        testFile: primaryTestFile,
      }),
    );
    const prompt = buildTestGenerationPrompt({
      repoRoot: config.workingTree,
      packageName: selection.packageName,
      pnpmFilter: selection.packageName,
      targets: promptTargets,
      maxTurns: config.maxClaudeTurns,
      exemplars,
      testCommand,
    });

    process.stderr.write(
      `[invoke-claude] package=${selection.packageName} targets=${promptTargets.length} ` +
        `maxTurns=${config.maxClaudeTurns} timeoutMs=${config.claudeTimeoutMs}\n`,
    );

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey && config.useBareAuth) {
      process.stderr.write("ANTHROPIC_API_KEY is not set (required for bare auth mode)\n");
      cleanupOnFail();
      return { success: false, config, isolated };
    }

    // Reuse the toolkit defaults: stream-json logging and skipped permissions.
    const { _toolkit_claudeResult: result, _toolkit_claudeStats: stats } = await runClaudeStepRun({
      prompt,
      worktreePath: config.workingTree,
      claudeOptions: {
        anthropicApiKey: apiKey,
        maxTurns: config.maxClaudeTurns,
        timeoutMs: config.claudeTimeoutMs,
        model: config.claudeModel,
        auth: config.useBareAuth ? "bare" : "auto",
        streamThinking: true,
        dangerouslySkipPermissions: true,
      },
    });

    writeClaudeStats(config.claudeStatsPath, {
      durationMs: stats?.durationMs ?? result.durationMs,
      apiDurationMs: stats?.apiDurationMs,
      totalCostUsd: stats?.totalCostUsd,
      numTurns: stats?.numTurns,
      inputTokens: stats?.inputTokens,
      outputTokens: stats?.outputTokens,
      cacheReadTokens: stats?.cacheReadTokens,
      cacheCreationTokens: stats?.cacheCreationTokens,
      success: result.success,
      errorMessage: result.errorMessage,
    });

    const turns = result.stats?.numTurns ?? 0;
    const cost = result.stats?.totalCostUsd;
    const inTok = result.stats?.inputTokens ?? 0;
    const outTok = result.stats?.outputTokens ?? 0;
    const costStr = typeof cost === "number" ? `$${cost.toFixed(4)}` : "n/a";
    process.stderr.write(
      `[invoke-claude] stats: turns=${turns} cost=${costStr} tokens_in=${inTok} tokens_out=${outTok}\n`,
    );

    if (!result.success) {
      process.stderr.write(
        `[invoke-claude] claude exited non-zero (exit=${result.exitCode})` +
          (result.errorMessage ? `: ${result.errorMessage}` : "") +
          "\n",
      );
      cleanupOnFail();
      return { success: false, config, isolated };
    }

    // Enforce the cost cap after the run; the CLI reports total cost only on
    // the final result event.
    if (
      typeof config.maxCostUsd === "number" &&
      typeof cost === "number" &&
      cost > config.maxCostUsd
    ) {
      process.stderr.write(
        `[invoke-claude] cost cap exceeded: $${cost.toFixed(4)} > $${config.maxCostUsd.toFixed(4)} (COVERAGE_AGENT_MAX_COST_USD)\n`,
      );
      cleanupOnFail();
      return { success: false, config, isolated };
    }

    if (!existsSync(config.agentOutputPath)) {
      process.stderr.write(
        `[invoke-claude] agent did not write ${config.agentOutputPath}; treating as gave_up\n`,
      );
      cleanupOnFail();
      return { success: false, config, isolated };
    }

    const agentOutput = readAgentOutput(config.agentOutputPath);
    if (agentOutput.status !== "success") {
      process.stderr.write(
        `[invoke-claude] agent reported status=${agentOutput.status}; rationale: ${agentOutput.rationale}\n`,
      );
      cleanupOnFail();
      return { success: false, config, isolated };
    }

    process.stdout.write(
      `[invoke-claude] ok — filesCreated=${agentOutput.filesCreated.length} filesModified=${agentOutput.filesModified.length}\n`,
    );
    if (isolated) {
      process.stderr.write(
        `[invoke-claude] active worktree: ${config.workingTree}\n` +
          "[invoke-claude] run `pnpm --filter @loti/coverage-agent run validate` next — it auto-detects the worktree.\n",
      );
    }
    return { success: true, config, isolated };
  } catch (err) {
    process.stderr.write(
      `[invoke-claude] unexpected error: ${(err as Error).stack ?? (err as Error).message}\n`,
    );
    cleanupOnFail();
    return { success: false, config, isolated };
  } finally {
    uninstallSignalCleanup();
  }
}

export function copyInvokeInputsToWorktree(
  initialConfig: CoverageAgentConfig,
  worktreeConfig: CoverageAgentConfig,
): void {
  mkdirSync(worktreeConfig.runOutputDir, { recursive: true });
  copyFileSync(initialConfig.selectionJsonPath, worktreeConfig.selectionJsonPath);
  if (existsSync(initialConfig.stackBasePath)) {
    copyFileSync(initialConfig.stackBasePath, worktreeConfig.stackBasePath);
  }
  // Copy baseline coverage artifacts so the prompt can include uncovered
  // range hints inside the worktree too.
  if (existsSync(initialConfig.coverageFinalPath)) {
    mkdirSync(resolve(worktreeConfig.coverageFinalPath, ".."), { recursive: true });
    copyFileSync(initialConfig.coverageFinalPath, worktreeConfig.coverageFinalPath);
  }
  if (existsSync(initialConfig.coverageSummaryPath)) {
    mkdirSync(resolve(worktreeConfig.coverageSummaryPath, ".."), { recursive: true });
    copyFileSync(initialConfig.coverageSummaryPath, worktreeConfig.coverageSummaryPath);
  }
  // The stryker baseline is written by `stryker-baseline` before the worktree
  // exists; without this copy `validate` reads from the worktree path, finds
  // nothing, and the mutation regression gate silently skips.
  if (existsSync(initialConfig.strykerBeforeJsonPath)) {
    mkdirSync(resolve(worktreeConfig.strykerBeforeJsonPath, ".."), { recursive: true });
    copyFileSync(initialConfig.strykerBeforeJsonPath, worktreeConfig.strykerBeforeJsonPath);
  }
}

export async function runInvokeClaude(
  initialConfig: CoverageAgentConfig = loadConfig(),
  stage: typeof invokeClaudeStage = invokeClaudeStage,
): Promise<number> {
  const result = await stage(initialConfig);
  return result.success ? 0 : 1;
}

/**
 * Remove the ephemeral worktree and its marker file. Idempotent.
 */
export function cleanupEphemeralWorktree(
  repoRoot: string,
  worktreePath: string,
  markerPath: string,
  keep: boolean,
  spawn?: SpawnFn,
): void {
  if (keep) return;
  // Call the adapter directly so tests can inject `spawn`.
  removeWorktree({ repoRoot, worktreePath, spawn });
  removeWorktreeMarker(markerPath);
}

/**
 * Install SIGINT/SIGTERM handlers that run cleanup once, then exit.
 */
export function installSignalCleanup(
  cleanup: () => void,
  target: NodeJS.EventEmitter = process,
  exit: (code: number) => void = process.exit,
): () => void {
  let handled = false;
  const handler = (signal: NodeJS.Signals): void => {
    if (handled) return;
    handled = true;
    process.stderr.write(`[invoke-claude] received ${signal}, cleaning up\n`);
    try {
      cleanup();
    } catch {
      // best-effort — the process is about to exit
    }
    exit(signal === "SIGINT" ? 130 : 143);
  };
  target.on("SIGINT", handler);
  target.on("SIGTERM", handler);
  return () => {
    target.off("SIGINT", handler);
    target.off("SIGTERM", handler);
  };
}
