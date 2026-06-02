import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

// Persisted stats from the post-review fix-turn. Written only when fix-turn
// actually runs (reviewAndFixStep gates on blocking findings). Consumed by
// open-pr to roll fix-turn cost/tokens into the PR body alongside the
// invoke-claude and reviewer numbers — the three phases together are the
// real per-file spend, not the invoke-claude number alone.
export const FixTurnStatsArtifactSchema = z.strictObject({
  durationMs: z.number().nonnegative(),
  totalCostUsd: z.number().nonnegative().optional(),
  numTurns: z.number().int().nonnegative().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheCreationTokens: z.number().int().nonnegative().optional(),
  success: z.boolean(),
});

export type FixTurnStatsArtifact = z.infer<typeof FixTurnStatsArtifactSchema>;

export function readFixTurnStats(path: string): FixTurnStatsArtifact {
  return FixTurnStatsArtifactSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function writeFixTurnStats(path: string, value: FixTurnStatsArtifact): void {
  const validated = FixTurnStatsArtifactSchema.parse(value);
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}
