import type { CoverageSummary, FileCoverage, PackageScore } from "../types.js";
import type { DiscoveredPackage } from "./discoverPackages.js";
import { findPackageForFile } from "./discoverPackages.js";
import { isPackageExcluded, isPackageUnderMinLoc } from "./filters.js";

type Aggregate = {
  totalLines: number;
  coveredLines: number;
  fileCount: number;
};

export function aggregateByPackage(
  summary: CoverageSummary,
  packages: DiscoveredPackage[],
): Map<string, Aggregate> {
  const agg = new Map<string, Aggregate>();
  for (const [filePath, fileCov] of Object.entries(summary)) {
    if (filePath === "total") continue;
    const pkg = findPackageForFile(filePath, packages);
    if (!pkg) continue;
    const cov = fileCov as FileCoverage;
    const existing = agg.get(pkg.name) ?? {
      totalLines: 0,
      coveredLines: 0,
      fileCount: 0,
    };
    existing.totalLines += cov.lines.total;
    existing.coveredLines += cov.lines.covered;
    existing.fileCount += 1;
    agg.set(pkg.name, existing);
  }
  return agg;
}

export function scorePackages(
  summary: CoverageSummary,
  packages: DiscoveredPackage[],
): PackageScore[] {
  const aggregates = aggregateByPackage(summary, packages);
  const scored: PackageScore[] = [];
  for (const pkg of packages) {
    if (isPackageExcluded(pkg.name)) continue;
    const agg = aggregates.get(pkg.name);
    if (!agg) continue;
    if (isPackageUnderMinLoc(agg.totalLines)) continue;
    const uncoveredLines = agg.totalLines - agg.coveredLines;
    if (uncoveredLines <= 0) continue;
    const linePct = agg.totalLines === 0 ? 100 : (agg.coveredLines / agg.totalLines) * 100;
    scored.push({
      packageName: pkg.name,
      packageDir: pkg.dir,
      uncoveredLines,
      totalLines: agg.totalLines,
      linePct,
    });
  }
  return scored.sort((a, b) => b.uncoveredLines - a.uncoveredLines);
}
