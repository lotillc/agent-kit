import { existsSync, unlinkSync } from "node:fs";

import { headSha } from "@lotiai/agent-kit/git";

import { writeFixTurnStats } from "../artifacts/fixTurnStats.js";
import { readSelection } from "../artifacts/selection.js";
import { runFixTurn } from "../commands/fixTurn.js";
import { runReview } from "../commands/review.js";
import { runValidate } from "../commands/validate.js";
import type { CoverageAgentConfig } from "../config.js";
import { AbortedError, type CoverageAgentBag } from "../pipeline/bag.js";
import type { PipelineStep } from "../pipeline/runSteps.js";
import {
  addressableFindings,
  blockingFindings,
  downgradeTargetsByFindings,
} from "../review/applyFindings.js";
import { writeDroppedFindings } from "../review/droppedFindings.js";
import { readReviewArtifact, writeReviewArtifact } from "../review/index.js";
import { writeDropMarker } from "../review/writeDropMarker.js";

export const REVIEW_AND_FIX_STEP_NAME = "review-and-fix" as const;

export interface ReviewAndFixStageResult {
  success: boolean;
  droppedAll: boolean;
  abortMessage?: string;
}

/**
 * Coverage-agent-specific review/fix orchestration.
 *
 * Runs review, optional fix-turn, re-validation, re-review, and final
 * downgrade. Returns a structured result so the pipeline step can stay thin.
 */
export async function runReviewAndFixStage(
  config: CoverageAgentConfig,
): Promise<ReviewAndFixStageResult> {
  // Clear stale fix-turn stats so this run cannot reuse old spend data.
  if (existsSync(config.fixTurnStatsPath)) {
    unlinkSync(config.fixTurnStatsPath);
  }

  const reviewExit = await runReview(config);
  if (reviewExit !== 0) {
    return {
      success: false,
      droppedAll: false,
      abortMessage: `review failed (exit ${reviewExit})`,
    };
  }

  let review = readReviewArtifact(config.reviewPath);
  let blocking = blockingFindings(review.findings);
  let addressable = addressableFindings(review.findings);
  process.stderr.write(
    `[pipeline:review] ${review.findings.length} finding(s), ${blocking.length} blocking (critical), ${addressable.length - blocking.length} advisory (high)\n`,
  );

  // Only `critical` triggers fix-turn. `high` is advisory but still worth
  // fixing once the agent is already editing.
  if (blocking.length === 0) {
    return { success: true, droppedAll: false };
  }

  process.stderr.write(
    `[pipeline:fix-turn] addressing ${blocking.length} critical + ${addressable.length - blocking.length} high finding(s)\n`,
  );
  const fixResult = await runFixTurn(addressable, config);
  process.stderr.write(
    `[pipeline:fix-turn] done success=${fixResult.success} cost=$${fixResult.totalCostUsd?.toFixed(4) ?? "?"} duration=${fixResult.durationMs}ms\n`,
  );
  writeFixTurnStats(config.fixTurnStatsPath, {
    durationMs: fixResult.durationMs,
    totalCostUsd: fixResult.totalCostUsd,
    numTurns: fixResult.numTurns,
    inputTokens: fixResult.inputTokens,
    outputTokens: fixResult.outputTokens,
    cacheReadTokens: fixResult.cacheReadTokens,
    cacheCreationTokens: fixResult.cacheCreationTokens,
    success: fixResult.success,
  });

  // Fix-turn edited the tests, so re-run validation before shipping.
  process.stderr.write("[pipeline:validate] re-run after fix-turn\n");
  const revalidateExit = await runValidate(config);
  if (revalidateExit !== 0) {
    return {
      success: false,
      droppedAll: false,
      abortMessage: `re-validate after fix-turn failed (exit ${revalidateExit})`,
    };
  }

  // Capture the first review's spend before the second pass overwrites it.
  const preFixReviewTotals = {
    durationMs: review.durationMs,
    totalCostUsd: review.totalCostUsd,
    inputTokens: review.inputTokens,
    outputTokens: review.outputTokens,
    cacheReadTokens: review.cacheReadTokens,
    cacheCreationTokens: review.cacheCreationTokens,
  };

  process.stderr.write("[pipeline:review] re-run after fix-turn\n");
  const rereviewExit = await runReview(config);
  if (rereviewExit !== 0) {
    return {
      success: false,
      droppedAll: false,
      abortMessage: `re-review after fix-turn failed (exit ${rereviewExit})`,
    };
  }
  const postFixReview = readReviewArtifact(config.reviewPath);
  // Keep findings from the post-fix pass, but sum spend across both reviews.
  const sumOptional = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  review = {
    ...postFixReview,
    durationMs: postFixReview.durationMs + preFixReviewTotals.durationMs,
    totalCostUsd: sumOptional(postFixReview.totalCostUsd, preFixReviewTotals.totalCostUsd),
    inputTokens: sumOptional(postFixReview.inputTokens, preFixReviewTotals.inputTokens),
    outputTokens: sumOptional(postFixReview.outputTokens, preFixReviewTotals.outputTokens),
    cacheReadTokens: sumOptional(postFixReview.cacheReadTokens, preFixReviewTotals.cacheReadTokens),
    cacheCreationTokens: sumOptional(
      postFixReview.cacheCreationTokens,
      preFixReviewTotals.cacheCreationTokens,
    ),
  };
  writeReviewArtifact(config.reviewPath, review);
  blocking = blockingFindings(review.findings);
  addressable = addressableFindings(review.findings);
  process.stderr.write(
    `[pipeline:review] post-fix: ${blocking.length} blocking (critical), ${addressable.length - blocking.length} advisory (high)\n`,
  );

  if (blocking.length === 0) {
    return { success: true, droppedAll: false };
  }

  const downgrade = downgradeTargetsByFindings(config, blocking);
  process.stderr.write(
    `[pipeline:review] downgraded ${downgrade.downgraded} target(s); ${downgrade.remaining} remaining; dropped: ${downgrade.droppedFiles.join(", ") || "(none)"}; partial: ${downgrade.partiallyDowngradedFiles.join(", ") || "(none)"}\n`,
  );
  if (downgrade.revertedSourceEdits.length > 0) {
    process.stderr.write(
      `[pipeline:review] reverted ${downgrade.revertedSourceEdits.length} orphan source edit(s): ${downgrade.revertedSourceEdits.join(", ")}\n`,
    );
  }

  // Persist dropped findings for PR rendering and post-run inspection.
  if (downgrade.droppedByFile.length > 0) {
    writeDroppedFindings(config.droppedFindingsPath, {
      entries: downgrade.droppedByFile,
    });
    process.stderr.write(
      `[pipeline:review] persisted dropped findings for ${downgrade.droppedByFile.length} file(s) -> ${config.droppedFindingsPath}\n`,
    );
  }

  // If every generated test was dropped, write a marker file so the PR still
  // has diff content and the target can be quarantined.
  if (downgrade.remainingCreated === 0 && downgrade.droppedByFile.length > 0) {
    const selection = readSelection(config.selectionJsonPath);
    const runSha = (process.env.GITHUB_SHA ?? headSha({ cwd: config.workingTree })).slice(0, 12);
    const marker = writeDropMarker({
      workingTree: config.workingTree,
      packageName: selection.packageName,
      targetRepoRelativePath: selection.repoRelativeFilePath,
      runSha,
      droppedByFile: downgrade.droppedByFile,
    });
    process.stderr.write(
      `[pipeline:review] wrote drop marker ${marker.repoRelativePath} (all tests dropped)\n`,
    );
    return { success: true, droppedAll: true };
  }

  if (downgrade.remaining === 0) {
    process.stderr.write("[pipeline:review] all targets downgraded — aborting\n");
    return {
      success: false,
      droppedAll: false,
      abortMessage: "all targets downgraded by blocking findings",
    };
  }

  // Downgrade edited the worktree (block-level prune, full drops, or orphan
  // source-edit reverts), so the pre-downgrade metrics.json no longer matches
  // what ships. Re-run validate so the PR body and gates reflect surviving tests.
  if (downgrade.downgraded > 0) {
    process.stderr.write("[pipeline:validate] re-run after downgrade\n");
    const postDowngradeExit = await runValidate(config);
    if (postDowngradeExit !== 0) {
      return {
        success: false,
        droppedAll: false,
        abortMessage: `re-validate after downgrade failed (exit ${postDowngradeExit})`,
      };
    }
  }

  return { success: true, droppedAll: false };
}

export const reviewAndFixStep: PipelineStep<CoverageAgentBag> = {
  name: REVIEW_AND_FIX_STEP_NAME,
  run: async (bag) => {
    const result = await runReviewAndFixStage(bag.config);
    if (!result.success) {
      throw new AbortedError("quality", result.abortMessage ?? "review-and-fix failed");
    }
    return result.droppedAll ? { droppedAll: true } : {};
  },
};
