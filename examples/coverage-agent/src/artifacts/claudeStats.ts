import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

export const ClaudeStatsArtifactSchema = z.strictObject({
  durationMs: z.number().nonnegative(),
  apiDurationMs: z.number().nonnegative().optional(),
  totalCostUsd: z.number().nonnegative().optional(),
  numTurns: z.number().int().nonnegative().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheCreationTokens: z.number().int().nonnegative().optional(),
  success: z.boolean(),
  errorMessage: z.string().optional(),
});

export type ClaudeStatsArtifact = z.infer<typeof ClaudeStatsArtifactSchema>;

export function readClaudeStats(path: string): ClaudeStatsArtifact {
  return ClaudeStatsArtifactSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function writeClaudeStats(path: string, value: ClaudeStatsArtifact): void {
  const validated = ClaudeStatsArtifactSchema.parse(value);
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}
