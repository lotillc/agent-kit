import { existsSync } from "node:fs";

import { listOpenPrs, resolveStackBase } from "@lotiai/agent-kit/gh-cli";
import { headSha } from "@lotiai/agent-kit/git";
import { openPrStepRun } from "@lotiai/agent-kit/steps";

import { readAgentOutput } from "../artifacts/agentOutput.js";
import { readClaudeStats } from "../artifacts/claudeStats.js";
import { readFixTurnStats } from "../artifacts/fixTurnStats.js";
import { readMetrics } from "../artifacts/metrics.js";
import { readSelection } from "../artifacts/selection.js";
import { readStackBase } from "../artifacts/stackBase.js";
import type { CoverageAgentConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { aggregateStatsForPrBody } from "../pr/aggregateStats.js";
import { validateAllowedBaseBranch } from "../pr/baseBranchGate.js";
import { renderPrBody, renderPrTitle } from "../pr/prBody.js";
import { slugify } from "../pr/slugify.js";
import { readDroppedFindingsIfExists } from "../review/droppedFindings.js";
import { type ReviewArtifact, readReviewArtifact } from "../review/index.js";
import { buildQuarantineTrailers } from "../stack/index.js";

import { cleanupEphemeralWorktree } from "./invokeClaude.js";

export interface OpenPrStageResult {
  success: boolean;
  prUrl?: string;
}

export function openPrStage(
  metricsJsonPath: string,
  config: CoverageAgentConfig = loadConfig(),
): OpenPrStageResult {
  const metrics = readMetrics(metricsJsonPath);
  // Prefer GITHUB_SHA (CI) for traceability; fall back to the worktree's
  // HEAD locally. Always append a short timestamp so repeated runs from the
  // same commit (the common local-iteration pattern) don't collide.
  const sha = (process.env.GITHUB_SHA ?? headSha({ cwd: config.workingTree })).slice(0, 7);
  const runStamp = Date.now().toString(36).slice(-6);
  const pkgSlug = slugify(metrics.packageName);
  const primaryTarget = metrics.targets[0];
  if (!primaryTarget) {
    process.stderr.write("[open-pr] metrics.targets is empty; nothing to ship\n");
    return { success: false };
  }
  // Batch runs use a "batch-<sha>-<stamp>" branch; N=1 keeps the
  // pre-batching file-slug branch name so single-file PRs look identical.
  const branchSuffix =
    metrics.targets.length > 1
      ? `batch-${sha}-${runStamp}`
      : `${slugify(primaryTarget.repoRelativeFilePath).slice(0, 60)}-${sha}-${runStamp}`;
  const branchName = `coverage-agent/run/${pkgSlug}/${branchSuffix}`;
  let review: ReviewArtifact | undefined;
  if (existsSync(config.reviewPath)) {
    try {
      review = readReviewArtifact(config.reviewPath);
    } catch (err) {
      process.stderr.write(`[open-pr] skipping review section: ${(err as Error).message}\n`);
    }
  }
  let suspectedBugs: ReturnType<typeof readAgentOutput>["suspectedBugs"] | undefined;
  if (existsSync(config.agentOutputPath)) {
    try {
      suspectedBugs = readAgentOutput(config.agentOutputPath).suspectedBugs;
    } catch {
      // malformed agent-output shouldn't block PR
    }
  }
  // When the reviewer dropped every test, agent-output's filesCreated is
  // empty. Use that as the signal to switch the PR into "record-only" mode
  // (distinct title + different framing in the body).
  const droppedFindings = readDroppedFindingsIfExists(config.droppedFindingsPath);
  const filesCreatedCount = (() => {
    if (!existsSync(config.agentOutputPath)) return null;
    try {
      return readAgentOutput(config.agentOutputPath).filesCreated.length;
    } catch {
      return null;
    }
  })();
  const droppedOnly = Boolean(
    droppedFindings && droppedFindings.entries.length > 0 && filesCreatedCount === 0,
  );
  const titleTargets = metrics.targets.map((t) => t.relativeFilePath);
  const title = renderPrTitle(metrics.packageName, titleTargets, { droppedOnly });
  // Prefer per-phase artifacts for PR stats; fall back to metrics.json for
  // older or manual runs.
  const claudeStats = existsSync(config.claudeStatsPath)
    ? readClaudeStats(config.claudeStatsPath)
    : undefined;
  const fixTurnStats = existsSync(config.fixTurnStatsPath)
    ? readFixTurnStats(config.fixTurnStatsPath)
    : undefined;
  const stats = claudeStats
    ? aggregateStatsForPrBody({ generation: claudeStats, review, fixTurn: fixTurnStats })
    : {
        tokensIn: metrics.tokensIn,
        tokensOut: metrics.tokensOut,
        totalCostUsd: metrics.costUsd,
        generationTurns: metrics.iterations,
      };
  const body = renderPrBody({
    packageName: metrics.packageName,
    targets: metrics.targets.map((t) => ({
      relativeFilePath: t.relativeFilePath,
      coverageBefore: t.coverageBefore,
      coverageAfter: t.coverageAfter,
      mutationBefore: t.mutationBefore,
      mutationAfter: t.mutationAfter,
    })),
    stats,
    workflowRunUrl: config.workflowRunUrl,
    review,
    suspectedBugs,
    droppedTests: droppedFindings?.entries,
  });

  // Prefer the persisted stack base so the PR stays anchored to the worktree
  // fork point. Manual flows fall back to live resolution.
  const stackBaseArtifact = existsSync(config.stackBasePath)
    ? readStackBase(config.stackBasePath)
    : null;
  let baseBranch: string;
  let stackedDescription: string;
  if (stackBaseArtifact) {
    baseBranch = stackBaseArtifact.baseBranch;
    stackedDescription = `stacked=${stackBaseArtifact.isStacked} (from stack-base.json, sha=${stackBaseArtifact.baseSha.slice(0, 7)})`;
  } else {
    const openPrs = listOpenPrs({ cwd: config.workingTree, label: "coverage-agent" });
    const stackBase = resolveStackBase({
      sandboxBranch: config.sandboxBranch,
      openPrs,
    });
    baseBranch = stackBase.baseBranch;
    stackedDescription = `stacked=${stackBase.isStacked}, open=${stackBase.openPrs.length} (no stack-base.json; re-resolved)`;
  }
  process.stderr.write(`[open-pr] base=${baseBranch} (${stackedDescription})\n`);

  const baseError = validateAllowedBaseBranch({
    baseBranch,
    allowedBaseBranches: config.allowedBaseBranches,
  });
  if (baseError) {
    process.stderr.write(`${baseError}\n`);
    return { success: false };
  }

  const commitMessage = buildCommitMessage(title, config);
  let prUrl: string;

  try {
    ({ _toolkit_prUrl: prUrl } = openPrStepRun({
      _toolkit_worktreePath: config.workingTree,
      prBranch: branchName,
      prBaseBranch: baseBranch,
      prTitle: title,
      prBody: body,
      commitMessage,
      prLabels: [config.prLabel],
    }));
    process.stdout.write(`opened ${prUrl}\n`);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return { success: false };
  }

  // Default to keeping the worktree for inspection. The next pipeline run
  // cleans up stale markers; CI can opt out with KEEP_WORKTREE=false.
  if (config.workingTree !== config.repoRoot) {
    if (config.keepWorktree) {
      process.stderr.write(
        `[open-pr] keeping worktree at ${config.workingTree} (next run will clean stale marker)\n`,
      );
    } else {
      cleanupEphemeralWorktree(
        config.repoRoot,
        config.workingTree,
        config.worktreeMarkerPath,
        false,
      );
      process.stderr.write(`[open-pr] removed ephemeral worktree ${config.workingTree}\n`);
    }
  }
  return { success: true, prUrl };
}

export function runOpenPr(
  metricsJsonPath: string,
  config: CoverageAgentConfig = loadConfig(),
  stage: typeof openPrStage = openPrStage,
): number {
  return stage(metricsJsonPath, config).success ? 0 : 1;
}

function buildCommitMessage(title: string, config: CoverageAgentConfig): string {
  // Build Quarantine-File trailers for targets that produced no shipped test.
  try {
    if (!existsSync(config.selectionJsonPath) || !existsSync(config.agentOutputPath)) {
      return title;
    }
    const selection = readSelection(config.selectionJsonPath);
    const agentOutput = readAgentOutput(config.agentOutputPath);
    const produced = new Set<string>(
      [...agentOutput.filesCreated, ...agentOutput.filesModified]
        .map((p) => p.match(/^(.*?)\/src\/__tests__\/(.+?)\.vitest\.ts$/))
        .flatMap((m) => (m ? [`${m[1]}/src/${m[2]}.ts`] : [])),
    );
    const quarantine = selection.targets
      .filter((t) => !produced.has(t.repoRelativeFilePath))
      .map((t) => ({
        sourceRepoRel: t.repoRelativeFilePath,
        reason: agentOutput.rationale || "agent produced no test",
      }));
    const trailers = buildQuarantineTrailers(quarantine);
    return trailers ? `${title}\n\n${trailers}` : title;
  } catch {
    return title;
  }
}
