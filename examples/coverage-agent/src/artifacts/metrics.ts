import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

// Per-target coverage + mutation snapshot. N=1 runs write a targets[] array
// with one entry; N>1 runs (batched) write one entry per target file.
export const MetricsTargetSchema = z.strictObject({
  repoRelativeFilePath: z.string(),
  relativeFilePath: z.string(),
  coverageBefore: z.strictObject({ line: z.number(), branch: z.number() }),
  coverageAfter: z.strictObject({ line: z.number(), branch: z.number() }),
  mutationBefore: z.number().nullable(),
  mutationAfter: z.number().nullable(),
});
export type MetricsTarget = z.infer<typeof MetricsTargetSchema>;

// Payload handed from `validate` to `open-pr` on disk.
export const MetricsArtifactSchema = z.strictObject({
  packageName: z.string(),
  // One entry per source file covered by this run. Always non-empty — a run
  // that produces zero usable test files should not have written metrics at
  // all; validate() aborts before reaching writeMetrics in that case.
  targets: z.array(MetricsTargetSchema).min(1),
  // Run-level aggregates (shared across all targets in one session).
  iterations: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});

export type MetricsArtifact = z.infer<typeof MetricsArtifactSchema>;

export function readMetrics(path: string): MetricsArtifact {
  return MetricsArtifactSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function writeMetrics(path: string, value: MetricsArtifact): void {
  const validated = MetricsArtifactSchema.parse(value);
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}
