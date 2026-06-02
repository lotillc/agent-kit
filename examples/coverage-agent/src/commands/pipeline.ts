import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { listOpenPrs } from "@lotiai/agent-kit/gh-cli";
import type { SpawnFn } from "@lotiai/agent-kit/ports";
import { defaultSpawn } from "@lotiai/agent-kit/process";

import { readOptionalJson } from "../artifacts/optional.js";
import type { CoverageAgentConfig } from "../config.js";
import { loadConfig } from "../config.js";
import {
  AbortedError,
  type CoverageAgentBag,
  DryRunError,
  NoWorkError,
  type PipelineOutcome,
} from "../pipeline/bag.js";
import { type PipelineStep, runSteps } from "../pipeline/runSteps.js";
import { PROMPT_VERSION } from "../prompts/buildTestGenerationPrompt.js";
import {
  baselineStep,
  doctorStep,
  dryRunGateStep,
  invokeClaudeStep,
  openPrStep,
  reviewAndFixStep,
  selectStep,
  strykerBaselineStep,
  validateStep,
} from "../steps/index.js";

import { cleanupEphemeralWorktree } from "./invokeClaude.js";

function log(phase: string, msg: string): void {
  process.stderr.write(`[pipeline:${phase}] ${msg}\n`);
}

/**
 * Paranoid cleanup at the top of a pipeline run: a pipeline is end-to-end in
 * one process, so any pre-existing worktree marker is stale (leftover from a
 * prior aborted run). Tear it down before step 0 — otherwise baseline-coverage
 * and every subsequent step operate in a possibly-corrupted /tmp worktree.
 *
 * The marker exists for the manual debug flow (`invoke-claude` → `validate` →
 * `open-pr` in separate shells); those commands respect the marker
 * themselves, so this cleanup doesn't affect them.
 *
 * Returns a fresh config pointing at `repoRoot` when a marker was cleared,
 * or the untouched input config otherwise. Exported for tests.
 */
export function clearStaleWorktree(
  initialConfig: CoverageAgentConfig,
  reload: () => CoverageAgentConfig = () => loadConfig(),
  spawn: SpawnFn = defaultSpawn,
): CoverageAgentConfig {
  if (!existsSync(initialConfig.worktreeMarkerPath)) return initialConfig;
  const staleWorktree = readFileSync(initialConfig.worktreeMarkerPath, "utf8").trim();
  log("start", `clearing stale worktree marker (was ${staleWorktree})`);
  cleanupEphemeralWorktree(
    initialConfig.repoRoot,
    staleWorktree,
    initialConfig.worktreeMarkerPath,
    false,
    spawn,
  );
  return reload();
}

/**
 * Linear step list that makes up the coverage-agent pipeline. Kept as an
 * exported constant so tests can introspect the sequence.
 */
export const COVERAGE_AGENT_PIPELINE: ReadonlyArray<PipelineStep<CoverageAgentBag>> = [
  baselineStep,
  selectStep,
  doctorStep,
  dryRunGateStep,
  strykerBaselineStep,
  invokeClaudeStep,
  reviewAndFixStep,
  validateStep,
  openPrStep,
];

export async function runPipeline(
  initialConfig: CoverageAgentConfig = loadConfig(),
): Promise<number> {
  const config = clearStaleWorktree(initialConfig);
  mkdirSync(config.runOutputDir, { recursive: true });

  // 0. Stack-depth gate. If there are already >= maxStackDepth open
  // coverage-agent PRs, skip this run with stack_full. No token spend.
  const openPrs = listOpenPrs({ cwd: config.workingTree, label: config.prLabel });
  if (openPrs.length >= config.maxStackDepth) {
    log(
      "stack-full",
      `${openPrs.length}/${config.maxStackDepth} open coverage-agent PRs; skipping run`,
    );
    writeStackFullRecord(config, openPrs.length);
    return 0;
  }

  // Track the latest successful-step bag so the error path can finalize with
  // the same config the failing step saw. For pre-invoke-claude failures this
  // is the caller's `initialConfig` (preserving any custom fields a
  // non-default caller passed in); for post-invoke-claude failures it's the
  // worktree-reloaded config the step swapped in.
  let latestBag: CoverageAgentBag = { config };
  try {
    const finalBag = await runSteps<CoverageAgentBag>(
      COVERAGE_AGENT_PIPELINE,
      { config },
      {
        log: (stepName) => log(stepName, "start"),
        onStepComplete: (bag) => {
          latestBag = bag;
        },
      },
    );
    const terminalOutcome: PipelineOutcome = finalBag.droppedAll
      ? "pr_opened_dropped"
      : "pr_opened";
    return finalize(finalBag.config, terminalOutcome);
  } catch (err) {
    const outcome = errorToOutcome(err);
    if (outcome === null) throw err;
    return finalize(latestBag.config, outcome);
  }
}

function errorToOutcome(err: unknown): PipelineOutcome | null {
  if (err instanceof NoWorkError) return "no_work";
  if (err instanceof DryRunError) return "dry_run";
  if (err instanceof AbortedError) {
    return err.phase === "baseline" ? "aborted_baseline" : "aborted_quality";
  }
  return null;
}

function finalize(config: CoverageAgentConfig, outcome: PipelineOutcome): number {
  writeRunSummary(config, outcome);
  log("done", `outcome=${outcome}`);
  const successOutcomes: PipelineOutcome[] = [
    "pr_opened",
    "pr_opened_dropped",
    "no_work",
    "dry_run",
  ];
  return successOutcomes.includes(outcome) ? 0 : 1;
}

function writeRunSummary(config: CoverageAgentConfig, outcome: PipelineOutcome): void {
  const selection = readOptionalJson(config.selectionJsonPath);
  const metrics = readOptionalJson(config.metricsPath);
  const claudeStats = readOptionalJson(config.claudeStatsPath);
  const summary = {
    date: new Date().toISOString(),
    outcome,
    // Version of the test-generation prompt used for this run. Bumped on
    // non-trivial prompt changes so a future aggregator can correlate
    // prompt versions with outcome / cost / accept-rate trends.
    promptVersion: PROMPT_VERSION,
    package: selection?.packageName ?? null,
    targetCount: (selection?.targets as { length: number } | undefined)?.length ?? null,
    primaryFile: selection?.repoRelativeFilePath ?? null,
    coverageBefore: selection?.coverageBefore ?? null,
    coverageAfter: metrics?.coverageAfter ?? null,
    mutationBefore: metrics?.mutationBefore ?? null,
    mutationAfter: metrics?.mutationAfter ?? null,
    iterations: metrics?.iterations ?? claudeStats?.numTurns ?? null,
    tokensIn: metrics?.tokensIn ?? claudeStats?.inputTokens ?? null,
    tokensOut: metrics?.tokensOut ?? claudeStats?.outputTokens ?? null,
    costUsd: metrics?.costUsd ?? claudeStats?.totalCostUsd ?? null,
  };
  writeFileSync(config.runRecordPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

function writeStackFullRecord(config: CoverageAgentConfig, openCount: number): void {
  mkdirSync(config.runOutputDir, { recursive: true });
  writeFileSync(
    config.runRecordPath,
    `${JSON.stringify(
      {
        date: new Date().toISOString(),
        outcome: "stack_full",
        openPrCount: openCount,
        maxStackDepth: config.maxStackDepth,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export { NO_WORK_EXIT_CODE } from "../pipeline/bag.js";
