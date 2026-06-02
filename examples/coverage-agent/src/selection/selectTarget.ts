import type { CoverageSummary, SelectionResult } from "../types.js";
import type { DiscoveredPackage } from "./discoverPackages.js";
import {
  pickFilesWithinBudget,
  type ScoreFilesOptions,
  scoreFilesInPackage,
} from "./scoreFiles.js";
import { scorePackages } from "./scorePackages.js";

export type ExemplarResolver = (pkg: DiscoveredPackage) => string[];

export interface SelectTargetOptions {
  locBudget?: number;
  /**
   * Hard cap on the number of files picked per run. min(maxFiles, LoC)
   * semantics — whichever hits first. Undefined means no file-count cap.
   */
  maxFiles?: number;
  /** Stack-ancestry driven exclusions. See scoreFilesInPackage. */
  scoreFilesOptions?: ScoreFilesOptions;
}

// Picks the top-ranked package and the prefix of its ranked files that fits
// within the LoC budget. Returns null if no package has eligible files.
export function selectTarget(
  summary: CoverageSummary,
  packages: DiscoveredPackage[],
  resolveExemplars: ExemplarResolver,
  options: SelectTargetOptions = {},
): SelectionResult | null {
  const rankedPackages = scorePackages(summary, packages);
  for (const pkgScore of rankedPackages) {
    const pkg = packages.find((p) => p.name === pkgScore.packageName);
    if (!pkg) continue;
    const files = scoreFilesInPackage(summary, pkg, packages, options.scoreFilesOptions);
    const targets = pickFilesWithinBudget(files, {
      budgetUncoveredLines: options.locBudget ?? 1,
      maxFiles: options.maxFiles,
    });
    const top = targets[0];
    if (!top) continue;
    return {
      package: pkgScore,
      file: top,
      targets,
      exemplarTestPaths: resolveExemplars(pkg),
    };
  }
  return null;
}
