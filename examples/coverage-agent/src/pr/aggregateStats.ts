import type { ClaudeStatsArtifact } from "../artifacts/claudeStats.js";
import type { FixTurnStatsArtifact } from "../artifacts/fixTurnStats.js";
import type { ReviewArtifact } from "../review/index.js";

import type { PrBodyStats } from "./prBody.js";

/**
 * Roll up cost and token counts across the three Claude invocations that
 * can happen per file — generation (`invoke-claude` / `claude-stats.json`),
 * reviewers (`review.json`, already merged primary + adversarial), and the
 * optional post-review fix-turn (`fix-turn-stats.json`).
 *
 * Why this exists: the PR body previously showed only the invoke-claude
 * numbers, leaving review + fix-turn costs invisible to the human
 * reviewer, and its "tokens in" figure excluded cache-read tokens — so
 * on a multi-minute session the PR would claim "in 31 tokens" which
 * read like a bug. This aggregator sums the per-phase artifacts into the
 * shape `renderPrBody` expects.
 *
 * `undefined` inputs are tolerated — each phase's artifact is independently
 * optional (e.g., fix-turn doesn't run when the reviewer has no blocking
 * findings).
 */
export function aggregateStatsForPrBody(sources: {
  generation?: ClaudeStatsArtifact;
  review?: ReviewArtifact;
  fixTurn?: FixTurnStatsArtifact;
}): PrBodyStats {
  const { generation, review, fixTurn } = sources;

  // "Total input tokens" in the PR body means the full footprint — bare
  // input + cache-read + cache-create — because every session after the
  // first turn is mostly cache-reads; showing only bare inputTokens hides
  // ~99% of the real token count.
  const phaseTokensIn = (s: {
    inputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  }): number => (s.inputTokens ?? 0) + (s.cacheReadTokens ?? 0) + (s.cacheCreationTokens ?? 0);

  const tokensIn =
    (generation ? phaseTokensIn(generation) : 0) +
    (review ? phaseTokensIn(review) : 0) +
    (fixTurn ? phaseTokensIn(fixTurn) : 0);
  const tokensOut =
    (generation?.outputTokens ?? 0) + (review?.outputTokens ?? 0) + (fixTurn?.outputTokens ?? 0);

  const generationCost = generation?.totalCostUsd;
  const reviewCost = review?.totalCostUsd;
  const fixTurnCost = fixTurn?.totalCostUsd;
  const totalCostUsd = (generationCost ?? 0) + (reviewCost ?? 0) + (fixTurnCost ?? 0);

  // Only emit the breakdown when at least one phase reported cost — keeps
  // the `Cost:` line clean on older/partial runs.
  const anyCostReported =
    generationCost !== undefined || reviewCost !== undefined || fixTurnCost !== undefined;
  const costBreakdown = anyCostReported
    ? {
        generation: generationCost,
        review: reviewCost,
        fixTurn: fixTurnCost,
      }
    : undefined;

  return {
    generationTurns: generation?.numTurns,
    tokensIn,
    tokensOut,
    totalCostUsd,
    costBreakdown,
  };
}
