import { describe, expect, test } from "vitest";

import type { ClaudeStatsArtifact } from "../artifacts/claudeStats.js";
import type { FixTurnStatsArtifact } from "../artifacts/fixTurnStats.js";
import { aggregateStatsForPrBody } from "../pr/aggregateStats.js";
import type { ReviewArtifact } from "../review/index.js";

function gen(stats: Partial<ClaudeStatsArtifact> = {}): ClaudeStatsArtifact {
  return { durationMs: 0, success: true, ...stats };
}

function rev(stats: Partial<ReviewArtifact> = {}): ReviewArtifact {
  return { reviewerName: "claude", durationMs: 0, findings: [], ...stats };
}

function fix(stats: Partial<FixTurnStatsArtifact> = {}): FixTurnStatsArtifact {
  return { durationMs: 0, success: true, ...stats };
}

describe("aggregateStatsForPrBody", () => {
  test("sums cost and tokens across all three phases", () => {
    const out = aggregateStatsForPrBody({
      generation: gen({
        numTurns: 31,
        inputTokens: 31,
        outputTokens: 18_871,
        cacheReadTokens: 12_000_000,
        cacheCreationTokens: 500_000,
        totalCostUsd: 0.882,
      }),
      review: rev({
        inputTokens: 20,
        outputTokens: 2_000,
        cacheReadTokens: 400_000,
        totalCostUsd: 0.5573,
      }),
      fixTurn: fix({
        inputTokens: 10,
        outputTokens: 1_500,
        cacheReadTokens: 200_000,
        totalCostUsd: 0.2414,
      }),
    });

    // Tokens-in must include bare input + cache-read + cache-create across
    // every phase — that is the "real footprint" label promised by the PR
    // body. The old PR body displayed only bare inputTokens (31 on a multi-
    // minute session), which is what this whole refactor exists to fix.
    expect(out.tokensIn).toBe(31 + 12_000_000 + 500_000 + 20 + 400_000 + 10 + 200_000);
    expect(out.tokensOut).toBe(18_871 + 2_000 + 1_500);
    expect(out.totalCostUsd).toBeCloseTo(0.882 + 0.5573 + 0.2414);
    expect(out.costBreakdown).toEqual({
      generation: 0.882,
      review: 0.5573,
      fixTurn: 0.2414,
    });
    // generationTurns is the invoke-claude numTurns — review + fix-turn
    // "turns" are deliberately excluded because they're a different concept
    // (short-session tool-call budget) and combining them into one number
    // would be misleading in the PR body.
    expect(out.generationTurns).toBe(31);
  });

  test("tolerates absent review and fix-turn (no reviewer blocking, no fix-turn)", () => {
    const out = aggregateStatsForPrBody({
      generation: gen({
        numTurns: 4,
        inputTokens: 100,
        outputTokens: 200,
        totalCostUsd: 0.25,
      }),
    });
    expect(out.generationTurns).toBe(4);
    expect(out.tokensIn).toBe(100);
    expect(out.tokensOut).toBe(200);
    expect(out.totalCostUsd).toBe(0.25);
    expect(out.costBreakdown).toEqual({
      generation: 0.25,
      review: undefined,
      fixTurn: undefined,
    });
  });

  test("omits costBreakdown entirely when no phase reported a cost", () => {
    // Some CI runs (e.g., cached / short-circuited) land here. Showing
    // "(generation $0.0000)" would imply we DID record a zero cost, so the
    // cleaner rendering is no breakdown at all.
    const out = aggregateStatsForPrBody({
      generation: gen({ numTurns: 2 }),
    });
    expect(out.costBreakdown).toBeUndefined();
    expect(out.totalCostUsd).toBe(0);
  });

  test("handles no sources at all (nothing persisted)", () => {
    const out = aggregateStatsForPrBody({});
    expect(out.tokensIn).toBe(0);
    expect(out.tokensOut).toBe(0);
    expect(out.totalCostUsd).toBe(0);
    expect(out.generationTurns).toBeUndefined();
    expect(out.costBreakdown).toBeUndefined();
  });
});
