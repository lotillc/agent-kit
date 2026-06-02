import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readSelection } from "../artifacts/selection.js";
import type { CoverageAgentConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { runStrykerOnFile } from "../runner/runStryker.js";

// Runs Stryker against the selected file (with existing tests only) and
// records the mutation score to config.strykerBeforeJsonPath. Soft-fail: any
// error writes `{ mutationScore: null }` so validate() can treat it as
// "no baseline available, don't gate on mutation".
export function runStrykerBaseline(config: CoverageAgentConfig = loadConfig()): number {
  if (!existsSync(config.selectionJsonPath)) {
    process.stderr.write(`selection.json not found; run select first\n`);
    return 1;
  }
  mkdirSync(config.runOutputDir, { recursive: true });

  const selection = readSelection(config.selectionJsonPath);
  // Mutate the union of selected targets in one Stryker run so the startup
  // cost is paid once per batch. Paths are package-relative; selection
  // target paths are already repo-relative (from `select`), so we re-derive
  // package-relative by stripping the packageDir prefix. For N=1 this
  // yields the same single-element array the pre-batching code produced.
  const packageDirAbs = resolve(config.workingTree, selection.packageDir);
  const targetFiles = selection.targets.map((t) =>
    t.repoRelativeFilePath.startsWith(`${selection.packageDir}/`)
      ? t.repoRelativeFilePath.slice(selection.packageDir.length + 1)
      : t.relativeFilePath,
  );
  const res = runStrykerOnFile({
    packageDir: packageDirAbs,
    targetFiles,
  });
  const mutationScore = typeof res.mutationScore === "number" ? res.mutationScore : null;
  writeFileSync(
    config.strykerBeforeJsonPath,
    `${JSON.stringify({ mutationScore }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(
    `[stryker-baseline] mutationScore=${mutationScore === null ? "null" : mutationScore.toFixed(1)}\n`,
  );
  // Always succeed — a missing baseline just means we skip the gate in validate.
  return 0;
}
