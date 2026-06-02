import { resolve } from "node:path";
import type { CoverageCount, CoverageSummary, FileCoverage } from "../types.js";

export const REPO_ROOT = "/repo";

export function cc(total: number, covered: number): CoverageCount {
  return {
    total,
    covered,
    skipped: 0,
    pct: total === 0 ? 100 : (covered / total) * 100,
  };
}

export function fileCov(lineTotal: number, lineCovered: number, branchPct = 100): FileCoverage {
  const lines = cc(lineTotal, lineCovered);
  return {
    lines,
    statements: lines,
    functions: cc(1, 1),
    branches: {
      total: 10,
      covered: Math.round((branchPct / 100) * 10),
      skipped: 0,
      pct: branchPct,
    },
  };
}

export function buildSummary(entries: Record<string, FileCoverage>): CoverageSummary {
  const summary: CoverageSummary = {};
  for (const [key, value] of Object.entries(entries)) {
    summary[resolve(REPO_ROOT, key)] = value;
  }
  return summary;
}

export function packageDir(relPath: string): string {
  return resolve(REPO_ROOT, relPath);
}
