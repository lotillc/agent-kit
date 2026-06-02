import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { listOpenPrs, resolveStackBase } from "@lotiai/agent-kit/gh-cli";
import { defaultSpawn } from "@lotiai/agent-kit/process";

import { type SelectionTarget, writeSelection } from "../artifacts/selection.js";
import type { CoverageAgentConfig } from "../config.js";
import { loadConfig } from "../config.js";
import {
  resolvePackagesFromVitestConfigs,
  selectTarget,
  synthesizeSinglePackage,
} from "../selection/index.js";
import { walkAncestry } from "../stack/index.js";
import { CoverageSummarySchema, type SelectionResult } from "../types.js";

export const NO_WORK_EXIT_CODE = 78;

function listVitestConfigs(repoRoot: string): string[] {
  const res = defaultSpawn("git", ["ls-files", "**/vitest.config.mts", "vitest.config.mts"], {
    cwd: repoRoot,
  });
  return res.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function pickExemplarsForPackage(packageDir: string, glob: string): string[] {
  const res = defaultSpawn("git", ["ls-files", glob], { cwd: packageDir });
  const files = res.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((rel) => resolve(packageDir, rel));
  return files.slice(0, 3);
}

export function runSelect(config: CoverageAgentConfig = loadConfig()): number {
  if (!existsSync(config.coverageSummaryPath)) {
    process.stderr.write(`coverage-summary.json not found at ${config.coverageSummaryPath}\n`);
    return 1;
  }
  const summary = CoverageSummarySchema.parse(
    JSON.parse(readFileSync(config.coverageSummaryPath, "utf8")),
  );

  // Walk the stack ancestry: union of test files added in any open
  // coverage-agent PR, plus their `Quarantine-File:` trailers. Falls back
  // to empty sets if `gh` is unavailable.
  const openPrs = listOpenPrs({ cwd: config.workingTree, label: "coverage-agent" });
  const stackBase = resolveStackBase({
    sandboxBranch: config.sandboxBranch,
    openPrs,
  });
  const ancestry = walkAncestry({
    baseRef: stackBase.baseRef,
    upstreamRef: config.upstreamRef,
    cwd: config.workingTree,
  });
  process.stderr.write(
    `[select] stack base=${stackBase.baseBranch} (stacked=${stackBase.isStacked}, open=${stackBase.openPrs.length}); ancestry: ${ancestry.coveredSourceFiles.size} covered, ${ancestry.quarantinedFiles.size} quarantined\n`,
  );

  // Single-package repos skip the per-package vitest-config glob and treat
  // the repo root as one synthetic package. Detection in loadConfig uses
  // pnpm-workspace.yaml + the `workspaces` field as the workspace signals.
  const packages = config.isSinglePackage
    ? [synthesizeSinglePackage(config.repoRoot)]
    : resolvePackagesFromVitestConfigs(listVitestConfigs(config.repoRoot), config.repoRoot);

  const result: SelectionResult | null = selectTarget(
    summary,
    packages,
    (pkg) => pickExemplarsForPackage(pkg.dir, config.testRunner.exemplarGlobPerPackage),
    {
      locBudget: config.locBudget,
      maxFiles: config.maxFilesPerRun,
      scoreFilesOptions: {
        repoRoot: config.repoRoot,
        coveredSet: ancestry.coveredSourceFiles,
        quarantinedMap: ancestry.quarantinedFiles,
      },
    },
  );

  if (!result) {
    process.stdout.write("no work available this cycle\n");
    return NO_WORK_EXIT_CODE;
  }

  mkdirSync(config.runOutputDir, { recursive: true });
  const targets: SelectionTarget[] = result.targets.map((t) => ({
    absoluteFilePath: t.absolutePath,
    relativeFilePath: t.relativePath,
    repoRelativeFilePath: relative(config.repoRoot, t.absolutePath),
    uncoveredLines: t.uncoveredLines,
    totalLines: t.totalLines,
    coverageBefore: { line: t.linePct, branch: t.branchPct },
  }));
  const primary = targets[0];
  if (!primary) return NO_WORK_EXIT_CODE;
  writeSelection(config.selectionJsonPath, {
    packageName: result.package.packageName,
    packageDir: relative(config.repoRoot, result.package.packageDir),
    targets,
    exemplarTestPaths: result.exemplarTestPaths.map((p) => relative(config.repoRoot, p)),
    locBudget: config.locBudget,
    absoluteFilePath: primary.absoluteFilePath,
    relativeFilePath: primary.relativeFilePath,
    repoRelativeFilePath: primary.repoRelativeFilePath,
    uncoveredLines: primary.uncoveredLines,
    totalLines: primary.totalLines,
    coverageBefore: primary.coverageBefore,
  });
  process.stdout.write(
    `selected ${result.package.packageName} :: ${targets.length} target(s); primary=${primary.repoRelativeFilePath}\n`,
  );
  // pickFilesWithinBudget always picks the top-ranked file, even if it
  // alone exceeds locBudget. Surface that case so a chronic offender shows
  // up in logs as a candidate for raising maxClaudeTurns / locBudget.
  if (primary.uncoveredLines > config.locBudget) {
    process.stderr.write(
      `[select] warning: primary ${primary.repoRelativeFilePath} has ${primary.uncoveredLines} uncovered LoC > locBudget=${config.locBudget}; the ${config.maxClaudeTurns}-turn Claude session may not finish. Consider bumping COVERAGE_AGENT_CLAUDE_MAX_TURNS or COVERAGE_AGENT_LOC_BUDGET.\n`,
    );
  }
  return 0;
}
