import { relative } from "node:path";
import type { CoverageSummary, FileCoverage, FileScore } from "../types.js";
import type { DiscoveredPackage } from "./discoverPackages.js";
import { findPackageForFile, relativeToPackage } from "./discoverPackages.js";
import {
  isBarrelIndex,
  isFileAlreadyCovered,
  isFileQuarantined,
  isFileTooLarge,
  matchesExcludedFilePattern,
} from "./filters.js";

export interface ScoreFilesOptions {
  /** Repo-relative source paths to exclude (derived from stack ancestry). */
  coveredSet?: ReadonlySet<string>;
  /** Quarantined source paths → reason (from Quarantine-File trailers). */
  quarantinedMap?: ReadonlyMap<string, string>;
  /** Repo root, needed to compute repo-relative path for ancestry filters. */
  repoRoot?: string;
}

export function scoreFilesInPackage(
  summary: CoverageSummary,
  pkg: DiscoveredPackage,
  allPackages: DiscoveredPackage[],
  options: ScoreFilesOptions = {},
): FileScore[] {
  const scored: FileScore[] = [];
  for (const [filePath, fileCov] of Object.entries(summary)) {
    if (filePath === "total") continue;
    const owner = findPackageForFile(filePath, allPackages);
    if (!owner || owner.name !== pkg.name) continue;
    const relPath = relativeToPackage(filePath, pkg);
    if (matchesExcludedFilePattern(relPath)) continue;
    const cov = fileCov as FileCoverage;
    if (isBarrelIndex(relPath, cov.lines.total)) continue;
    if (isFileTooLarge(cov.lines.total)) continue;

    // Stack-ancestry filters require a repo-relative path.
    if (options.repoRoot && (options.coveredSet || options.quarantinedMap)) {
      const repoRel = relative(options.repoRoot, filePath);
      if (options.coveredSet && isFileAlreadyCovered(repoRel, options.coveredSet)) continue;
      if (options.quarantinedMap && isFileQuarantined(repoRel, options.quarantinedMap)) continue;
    }

    const uncoveredLines = cov.lines.total - cov.lines.covered;
    if (uncoveredLines <= 0) continue;
    scored.push({
      absolutePath: filePath,
      relativePath: relPath,
      uncoveredLines,
      totalLines: cov.lines.total,
      linePct: cov.lines.pct,
      branchPct: cov.branches.pct,
    });
  }
  return scored.sort((a, b) => b.uncoveredLines - a.uncoveredLines);
}

export interface PickBudget {
  /** Target sum of uncoveredLines. Selection stops once met or exceeded. */
  budgetUncoveredLines: number;
  /**
   * Hard cap on the number of files returned. Selection stops at this count
   * regardless of remaining LoC budget — "min(N files, LoC)" semantics —
   * so one huge file can't monopolize a run and N tiny files can't dilute
   * the generation prompt. `Infinity` disables the cap.
   */
  maxFiles?: number;
}

/**
 * From a ranked list (highest uncovered lines first), peel files until
 * EITHER the uncovered-lines budget is met OR the `maxFiles` cap is
 * reached. Always returns at least one file if scored is non-empty, even
 * if it alone exceeds budget (the cap still applies — `maxFiles=0` yields
 * an empty result).
 */
export function pickFilesWithinBudget(scored: FileScore[], budget: PickBudget): FileScore[] {
  const maxFiles = budget.maxFiles ?? Number.POSITIVE_INFINITY;
  if (maxFiles <= 0) return [];
  const picked: FileScore[] = [];
  let spent = 0;
  for (const s of scored) {
    if (picked.length >= maxFiles) break;
    if (picked.length > 0 && spent + s.uncoveredLines > budget.budgetUncoveredLines) {
      break;
    }
    picked.push(s);
    spent += s.uncoveredLines;
    if (picked.length >= maxFiles) break;
    if (spent >= budget.budgetUncoveredLines) break;
  }
  return picked;
}
