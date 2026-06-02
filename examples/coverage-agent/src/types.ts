import { z } from "zod";

export const CoverageCountSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  covered: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  pct: z.number(),
});
export type CoverageCount = z.infer<typeof CoverageCountSchema>;

// Non-strict on purpose: v8/c8 emit extra keys like `branchesTrue` that we
// don't care about. We only read lines/statements/functions/branches.
export const FileCoverageSchema = z.object({
  lines: CoverageCountSchema,
  statements: CoverageCountSchema,
  functions: CoverageCountSchema,
  branches: CoverageCountSchema,
});
export type FileCoverage = z.infer<typeof FileCoverageSchema>;

// Vitest/c8's coverage-summary.json: Record<absolutePath | "total", FileCoverage>.
// "total" is an aggregate row we discard.
export const CoverageSummarySchema = z.record(z.string(), FileCoverageSchema);
export type CoverageSummary = z.infer<typeof CoverageSummarySchema>;

export type PackageScore = {
  packageName: string;
  packageDir: string;
  uncoveredLines: number;
  totalLines: number;
  linePct: number;
};

export type FileScore = {
  absolutePath: string;
  relativePath: string;
  uncoveredLines: number;
  totalLines: number;
  linePct: number;
  branchPct: number;
};

export type SelectionResult = {
  package: PackageScore;
  /** Primary (highest-value) file. Convenience alias for targets[0]. */
  file: FileScore;
  /** Multi-target set selected within the LoC budget. Always length >= 1. */
  targets: FileScore[];
  exemplarTestPaths: string[];
};
