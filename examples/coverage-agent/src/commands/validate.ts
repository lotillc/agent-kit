import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { validateWorkingTreeDiff } from "@lotiai/agent-kit/git";
import { defaultSpawn } from "@lotiai/agent-kit/process";

import { readAgentOutput, type SuspectedBug, writeAgentOutput } from "../artifacts/agentOutput.js";
import { readClaudeStats } from "../artifacts/claudeStats.js";
import { type MetricsTarget, writeMetrics } from "../artifacts/metrics.js";
import {
  readSelection,
  type SelectionArtifact,
  type SelectionTarget,
} from "../artifacts/selection.js";
import type { CoverageAgentConfig } from "../config.js";
import { loadConfig } from "../config.js";
import {
  resolveEslintBinPath,
  resolveTypescriptEslintParserUrl,
  resolveVitestEslintPluginUrl,
  writeAntiPatternLintConfig,
} from "../lint/antiPatternConfig.js";
import { extractSuspectedBugRationale } from "../prompts/suspectedBugMarker.js";
import { runAntiPatternLint } from "../runner/runLint.js";
import { runStrykerOnFile } from "../runner/runStryker.js";
import { runFlakeCheck, runVitestFile, type VitestTestResult } from "../runner/runVitest.js";
import { inferSourceFromVitest } from "../stack/walkAncestry.js";
import { CoverageSummarySchema, type FileCoverage } from "../types.js";

// Source directories the agent may touch (export-keyword-only). Same pattern
// as `commands/validateDiff.ts`.
const SOURCE_PATH_PATTERN =
  /^(packages|services|josu|infrastructure|tools|experimental)\/.+\/src\/.+\.ts$/;

type ValidateOutcome = "ok" | "aborted_quality";

/**
 * Resolve the source file a generated test covers. The selection is
 * authoritative in a single-target run, so never let path inference (which is
 * wrong for a root test covering a nested module) override it. For N>1, trust
 * inference only when it lands on a selected target; otherwise we're guessing,
 * so `confident` is false and the source is excluded from Stryker taint-skip.
 */
function resolveSourceForTestFile(
  testFileRepoRel: string,
  selection: SelectionArtifact,
): { sourceRepoRel: string; confident: boolean } {
  const only = selection.targets.length === 1 ? selection.targets[0] : undefined;
  if (only) return { sourceRepoRel: only.repoRelativeFilePath, confident: true };
  const inferred = inferSourceFromVitest(testFileRepoRel);
  if (inferred && selection.targets.some((t) => t.repoRelativeFilePath === inferred)) {
    return { sourceRepoRel: inferred, confident: true };
  }
  const fallback = selection.targets[0]?.repoRelativeFilePath ?? testFileRepoRel;
  return { sourceRepoRel: fallback, confident: false };
}

/**
 * Derive suspected-bug declarations from failing tests whose names carry the
 * `(suspected bug: …)` marker — the test name IS the declaration, so there is
 * no separate JSON entry to keep byte-identical. `taintSafeSources` lists the
 * sources we're confident enough about to exclude from Stryker mutation scoring.
 */
export function deriveSuspectedBugsFromFailures(
  testFileRepoRel: string,
  tests: readonly VitestTestResult[],
  selection: SelectionArtifact,
): { derived: SuspectedBug[]; taintSafeSources: string[] } {
  const derived: SuspectedBug[] = [];
  const taintSafeSources: string[] = [];
  const { sourceRepoRel, confident } = resolveSourceForTestFile(testFileRepoRel, selection);
  for (const t of tests) {
    if (t.passed) continue;
    const rationale = extractSuspectedBugRationale(t.name);
    if (!rationale) continue;
    derived.push({ sourceRepoRel, testRepoRel: testFileRepoRel, testName: t.name, rationale });
    if (confident) taintSafeSources.push(sourceRepoRel);
  }
  return { derived, taintSafeSources };
}

/**
 * Merge explicit `agent-output.json` entries with name-derived ones, deduped by
 * (testRepoRel, testName). Explicit entries win — their rationale and source
 * are agent-authored rather than auto-extracted from the test name.
 */
export function unionSuspectedBugs(
  explicit: readonly SuspectedBug[],
  derived: readonly SuspectedBug[],
): SuspectedBug[] {
  const byKey = new Map<string, SuspectedBug>();
  const keyOf = (b: SuspectedBug): string => `${b.testRepoRel}\u0000${b.testName}`;
  for (const b of derived) byKey.set(keyOf(b), b);
  for (const b of explicit) byKey.set(keyOf(b), b);
  return [...byKey.values()];
}

export async function runValidate(config: CoverageAgentConfig = loadConfig()): Promise<number> {
  mkdirSync(config.runOutputDir, { recursive: true });

  const selection = readSelection(config.selectionJsonPath);
  const agentOutput = readAgentOutput(config.agentOutputPath);
  const claudeStats = readClaudeStats(config.claudeStatsPath);

  const allTestFiles = collectTestFilesForValidation(
    [...agentOutput.filesCreated, ...agentOutput.filesModified],
    config.testRunner.testFilePatterns,
  );
  if (allTestFiles.length === 0) {
    return abort(config, "agent produced no files");
  }

  // 1. Full test suite — run every generated test file through vitest and the
  //    anti-pattern stderr gate. Each file runs independently so a second
  //    file can't smuggle `test.fails()` or arrow-constructor mocks past the
  //    gate just because the first file was clean.
  //
  // Two outcomes can both succeed here:
  //   (a) all tests pass — happy path.
  //   (b) the ONLY failing tests are the ones the agent declared as
  //       suspected-bug tests, and their titles name-match the
  //       `suspectedBugs[].testName` entries exactly. The PR ships with
  //       those red tests visible; merge is blocked by CI until the source
  //       is fixed. This is the new contract that replaced `test.fails()`.
  const packageDirAbs = resolve(config.workingTree, selection.packageDir);
  const pooledTests: VitestTestResult[] = [];
  let anyVitestFailed = false;
  const pooledAntiPatternWarnings: string[] = [];
  const pooledStderr: string[] = [];
  // Suspected bugs derived from failing tests whose names carry the marker.
  const derivedSuspectedBugs: SuspectedBug[] = [];
  const derivedTaintSafeSources = new Set<string>();
  for (let i = 0; i < allTestFiles.length; i++) {
    const testFileRepoRel = allTestFiles[i];
    if (!testFileRepoRel) continue;
    const testFileAbs = resolve(config.workingTree, testFileRepoRel);
    process.stderr.write(
      `[validate] full test suite (${i + 1}/${allTestFiles.length}): ${testFileRepoRel}\n`,
    );
    // Per-file JSON path so pooled results don't overwrite one another on
    // disk (useful for post-mortem) and so readVitestJsonResults inside
    // runVitestFile reads the correct run's output.
    const vitestJsonPath = join(config.runOutputDir, `vitest-results-${i}.json`);
    const res = runVitestFile({
      packageFilter: selection.packageName,
      testFile: testFileAbs,
      packageDir: packageDirAbs,
      cwd: config.workingTree,
      jsonOutputPath: vitestJsonPath,
    });
    pooledTests.push(...res.tests);
    if (!res.passed) anyVitestFailed = true;
    pooledAntiPatternWarnings.push(...res.antiPatternWarnings);
    pooledStderr.push(res.stderr);
    const { derived, taintSafeSources } = deriveSuspectedBugsFromFailures(
      testFileRepoRel,
      res.tests,
      selection,
    );
    derivedSuspectedBugs.push(...derived);
    for (const s of taintSafeSources) derivedTaintSafeSources.add(s);
  }
  // Merge explicit declarations with name-derived ones. Computed
  // unconditionally because taintedSources (Stryker) reads it even when no
  // test failed.
  const mergedSuspectedBugs = unionSuspectedBugs(agentOutput.suspectedBugs, derivedSuspectedBugs);
  if (anyVitestFailed) {
    const bugGate = gateFailuresAgainstSuspectedBugs(pooledTests, mergedSuspectedBugs);
    if (!bugGate.ok) {
      process.stderr.write(pooledStderr.join(""));
      return abort(config, `vitest on target file(s) failed: ${bugGate.reason}`);
    }
    process.stderr.write(
      `[validate] vitest reports ${bugGate.expectedFailureCount} expected failure(s) — all match declared suspectedBugs entries; proceeding\n`,
    );
  }

  // Anti-pattern stderr gate. Vitest v4 writes stderr warnings for
  // ship-blocking mistakes (arrow-function constructor mocks, etc.) but
  // exits 0 when tests pass. Treat any matched warning — across any file —
  // as fatal so the reviewer/drop flow takes over instead of shipping.
  if (pooledAntiPatternWarnings.length > 0) {
    process.stderr.write(pooledStderr.join(""));
    const dedup = [...new Set(pooledAntiPatternWarnings)];
    return abort(config, `vitest flagged anti-pattern warning(s): ${dedup.join(" | ")}`);
  }

  // 2. Coverage delta
  //
  // The package's coverage command runs vitest under the hood, which
  // non-zero-exits if any test fails. When the agent has declared
  // suspectedBugs, some tests WILL fail by design — but vitest still writes
  // the coverage summary. In that case we tolerate the non-zero exit as
  // long as the summary file exists; the downstream summary parse will
  // fail loudly if it's actually unreadable.
  process.stderr.write("[validate] recomputing coverage\n");
  const coverageCmd = config.packageManager.runCoverage();
  const coverageRes = defaultSpawn(coverageCmd.command, coverageCmd.args, {
    cwd: config.workingTree,
  });
  const coverageToleratedFailure =
    coverageRes.exitCode !== 0 &&
    mergedSuspectedBugs.length > 0 &&
    existsSync(config.coverageSummaryPath);
  if (coverageRes.exitCode !== 0 && !coverageToleratedFailure) {
    process.stderr.write(coverageRes.stderr);
    return abort(config, "coverage re-run failed");
  }
  if (coverageToleratedFailure) {
    process.stderr.write(
      "[validate] coverage command exited non-zero (expected: suspected-bug tests fail) — summary written, proceeding\n",
    );
  }
  const coverageSummary = CoverageSummarySchema.parse(
    JSON.parse(readFileSync(config.coverageSummaryPath, "utf8")),
  );
  // Per-target coverage lookup. For each target in selection.targets we
  // match the summary key by absolute path first, then by repo-rel suffix
  // (pnpm workspace symlinks and /private/var shim prefixes can differ
  // from config.workingTree exactly).
  const perTargetCoverage = new Map<string, { coverageAfter: { line: number; branch: number } }>();
  for (const target of selection.targets) {
    const rebasedTarget = resolve(config.workingTree, target.repoRelativeFilePath);
    const repoRelSuffix = `/${target.repoRelativeFilePath}`;
    const matchedKey =
      rebasedTarget in coverageSummary
        ? rebasedTarget
        : Object.keys(coverageSummary).find((k) => k.endsWith(repoRelSuffix));
    const after = matchedKey ? coverageSummary[matchedKey] : undefined;
    if (!after) {
      // A single missing target shouldn't abort the whole batch when the
      // reviewer may still have produced useful tests for sibling targets.
      // Treat it as "no coverage delta" and let the shipped-test gate below
      // catch a completely empty batch.
      process.stderr.write(
        `[validate] no coverage entry for ${target.repoRelativeFilePath} — treating as no delta\n`,
      );
      perTargetCoverage.set(target.repoRelativeFilePath, {
        coverageAfter: { line: target.coverageBefore.line, branch: target.coverageBefore.branch },
      });
      continue;
    }
    if (matchedKey && matchedKey !== rebasedTarget) {
      process.stderr.write(
        `[validate] coverage summary matched by suffix for ${target.repoRelativeFilePath} (expected ${rebasedTarget}, matched ${matchedKey})\n`,
      );
    }
    const fileCov = after as FileCoverage;
    perTargetCoverage.set(target.repoRelativeFilePath, {
      coverageAfter: { line: fileCov.lines.pct, branch: fileCov.branches.pct },
    });
  }
  // At least ONE target must have moved forward on line coverage. A batch
  // where nothing improved is the same failure mode as the pre-batching
  // "coverage did not increase" abort. We keep the abort at that granularity
  // (not per-target) because the reviewer + PR will naturally omit the
  // stagnant targets via Quarantine-File trailers.
  const shippedTargets = selection.targets.filter((t) => {
    const after = perTargetCoverage.get(t.repoRelativeFilePath);
    return after !== undefined && after.coverageAfter.line > t.coverageBefore.line;
  });
  if (shippedTargets.length === 0) {
    const deltas = selection.targets.map((t) => {
      const after = perTargetCoverage.get(t.repoRelativeFilePath)?.coverageAfter;
      return `${t.repoRelativeFilePath}: ${t.coverageBefore.line} → ${after?.line ?? "?"}`;
    });
    return abort(config, `no target improved line coverage — ${deltas.join("; ")}`);
  }

  // 3. Stryker on the union of target files (soft — missing score ⇒ skip,
  // never regress). Skip mutation scoring when any of the agent's suspected
  // bugs taints the selected sources: under the bare-failing-test contract,
  // a suspected-bug test is already red in baseline; a mutation that happens
  // to "repair" the bug would flip the test to passing, which Stryker would
  // report as a surviving mutant (false negative). We'd be penalizing
  // ourselves for catching bugs.
  // Taint = sources to exclude from Stryker. Explicit-declared sources are
  // always trusted; derived sources only when we confidently mapped the test
  // file to one. Iterate the merged list so an explicit override's source wins
  // over a derived guess for the same test, and ambiguous N>1 derivations (not
  // taint-safe) don't skip mutation on the wrong target.
  const explicitSources = new Set(agentOutput.suspectedBugs.map((b) => b.sourceRepoRel));
  const taintedSources = new Set<string>();
  for (const b of mergedSuspectedBugs) {
    if (explicitSources.has(b.sourceRepoRel) || derivedTaintSafeSources.has(b.sourceRepoRel)) {
      taintedSources.add(b.sourceRepoRel);
    }
  }
  const mutationBefore = readOptionalMutationScore(config.strykerBeforeJsonPath);
  let mutationAfter: number | null = null;
  const allTargetsTainted = selection.targets.every((t) =>
    taintedSources.has(t.repoRelativeFilePath),
  );
  if (allTargetsTainted && selection.targets.length > 0) {
    process.stderr.write(
      "[validate] stryker SKIPPED — all targets have active suspectedBugs entries\n",
    );
  } else {
    process.stderr.write("[validate] stryker\n");
    // Exclude tainted targets from the mutate union so we don't false-positive
    // on suspected-bug source files. For N=1 with no taint, this is a
    // single-element array (same behavior as before).
    const nonTaintedTargets = selection.targets.filter(
      (t) => !taintedSources.has(t.repoRelativeFilePath),
    );
    const mutateTargets = nonTaintedTargets.map((t) =>
      t.repoRelativeFilePath.startsWith(`${selection.packageDir}/`)
        ? t.repoRelativeFilePath.slice(selection.packageDir.length + 1)
        : t.relativeFilePath,
    );
    if (mutateTargets.length > 0) {
      const strykerRes = runStrykerOnFile({
        packageDir: packageDirAbs,
        targetFiles: mutateTargets,
      });
      mutationAfter = strykerRes.mutationScore;
      // mutationBefore was computed by strykerBaseline on the full selection
      // set (taint is only discovered post-agent), so it's only directly
      // comparable when the current mutate set matches that baseline set —
      // i.e. zero targets got tainted. When some targets are tainted we're
      // comparing a subset score against a superset baseline: the scores
      // aren't per-file-weighted the same way and a lower subset score
      // doesn't imply a real regression. Record the after-score for the PR
      // body but skip the gate.
      const mutateSetMatchesBaseline = nonTaintedTargets.length === selection.targets.length;
      if (
        mutationBefore !== null &&
        mutationAfter !== null &&
        mutationAfter < mutationBefore &&
        mutateSetMatchesBaseline
      ) {
        return abort(config, `mutation score regressed: ${mutationBefore} → ${mutationAfter}`);
      }
      if (!mutateSetMatchesBaseline && mutationBefore !== null && mutationAfter !== null) {
        process.stderr.write(
          `[validate] mutation regression gate SKIPPED — baseline mutated ${selection.targets.length} target(s) but ${selection.targets.length - nonTaintedTargets.length} became tainted; subset vs superset scores aren't directly comparable\n`,
        );
      }
    }
  }

  // 4. Anti-pattern lint (scoped, ESLint-based) — every generated test file.
  const vitestPluginUrl = resolveVitestEslintPluginUrl();
  const parserUrl = resolveTypescriptEslintParserUrl();
  // Realpath because ESLint resolves target files through symlinks (e.g. on
  // macOS /var → /private/var) and then compares against basePath literally.
  // If basePath still points through the symlink, every target is reported as
  // "outside of base path" and no rules run.
  const basePath = realpathSync(config.workingTree);
  writeAntiPatternLintConfig(
    config.antiPatternLintConfigPath,
    vitestPluginUrl,
    parserUrl,
    basePath,
  );
  const eslintBinPath = resolveEslintBinPath();
  for (let i = 0; i < allTestFiles.length; i++) {
    const testFileRepoRel = allTestFiles[i];
    if (!testFileRepoRel) continue;
    const testFileAbs = resolve(config.workingTree, testFileRepoRel);
    process.stderr.write(
      `[validate] anti-pattern lint (${i + 1}/${allTestFiles.length}): ${testFileRepoRel}\n`,
    );
    const lintRes = runAntiPatternLint({
      configPath: config.antiPatternLintConfigPath,
      targetFile: testFileAbs,
      cwd: config.workingTree,
      eslintBinPath,
    });
    if (!lintRes.passed) {
      process.stderr.write(lintRes.stdout);
      return abort(config, `anti-pattern lint failed on ${testFileRepoRel}`);
    }
  }

  // 5. Flake check (5 runs) — skipped when suspectedBugs are present
  // because by design a suspected-bug test fails every run, so the whole
  // flake re-run semantics ("must pass N times") is meaningless here. The
  // genuinely-flaky-test surface we care about is pass/fail non-determinism
  // in the other tests, which we accept we can't check for in this mode.
  if (mergedSuspectedBugs.length > 0) {
    process.stderr.write(
      "[validate] flake check SKIPPED — suspectedBugs entries make pass/fail stability meaningless\n",
    );
  } else {
    for (let i = 0; i < allTestFiles.length; i++) {
      const testFileRepoRel = allTestFiles[i];
      if (!testFileRepoRel) continue;
      const testFileAbs = resolve(config.workingTree, testFileRepoRel);
      process.stderr.write(
        `[validate] flake check ×${config.flakeRuns} (${i + 1}/${allTestFiles.length}): ${testFileRepoRel}\n`,
      );
      const flakeRes = runFlakeCheck(
        {
          packageFilter: selection.packageName,
          testFile: testFileAbs,
          packageDir: packageDirAbs,
          cwd: config.workingTree,
        },
        config.flakeRuns,
      );
      if (!flakeRes.passed) {
        return abort(config, `flake check failed on ${testFileRepoRel}`);
      }
    }
  }

  // 6. Diff gate
  process.stderr.write("[validate] diff gate\n");
  const diffRes = validateWorkingTreeDiff({
    cwd: config.workingTree,
    // HEAD = the commit the ephemeral worktree was checked out at, so the diff is exactly Claude's edits regardless of which branch the pipeline was invoked from.
    baseRef: "HEAD",
    testFilePatterns: config.testRunner.testFilePatterns,
    sourcePathPattern: SOURCE_PATH_PATTERN,
  });
  if (!diffRes.ok) {
    return abort(config, `diff gate rejected: ${diffRes.disallowed.join(", ")}`);
  }

  // Write metrics for open-pr. One entry per selected target. Per-target
  // mutation scores aren't currently parsed out of Stryker's JSON report — we
  // re-emit the batch-aggregate mutation score on each target so the PR body
  // can render "Mutation score: X" per file without lying about per-file
  // granularity. When per-file Stryker parsing lands this mirroring goes away.
  const metricsTargets: MetricsTarget[] = selection.targets.map(
    (t: SelectionTarget): MetricsTarget => {
      const coverageAfterForTarget =
        perTargetCoverage.get(t.repoRelativeFilePath)?.coverageAfter ?? t.coverageBefore;
      const suspectedBugForTarget = taintedSources.has(t.repoRelativeFilePath);
      return {
        repoRelativeFilePath: t.repoRelativeFilePath,
        relativeFilePath: t.relativeFilePath,
        coverageBefore: t.coverageBefore,
        coverageAfter: coverageAfterForTarget,
        mutationBefore: suspectedBugForTarget ? null : mutationBefore,
        mutationAfter: suspectedBugForTarget ? null : mutationAfter,
      };
    },
  );
  writeMetrics(config.metricsPath, {
    packageName: selection.packageName,
    targets: metricsTargets,
    iterations: claudeStats.numTurns ?? 0,
    tokensIn: claudeStats.inputTokens ?? 0,
    tokensOut: claudeStats.outputTokens ?? 0,
    costUsd: claudeStats.totalCostUsd ?? 0,
  });
  writePartialRunRecord(config, "ok", {
    targets: metricsTargets.map((t) => ({
      repoRelativeFilePath: t.repoRelativeFilePath,
      coverageAfter: t.coverageAfter,
    })),
    mutationBefore,
    mutationAfter,
  });
  // Persist name-derived suspected bugs so open-pr renders them without the
  // agent having to hand-write agent-output.json. No-op when none were derived.
  if (derivedSuspectedBugs.length > 0) {
    writeAgentOutput(config.agentOutputPath, {
      ...agentOutput,
      suspectedBugs: mergedSuspectedBugs,
    });
  }

  // shippedTargets was already asserted non-empty above (we'd have aborted).
  const firstShipped = shippedTargets[0];
  if (!firstShipped) {
    return abort(config, "internal: shippedTargets became empty after write");
  }
  const firstAfter =
    perTargetCoverage.get(firstShipped.repoRelativeFilePath)?.coverageAfter ??
    firstShipped.coverageBefore;
  process.stdout.write(
    `[validate] ok — ${shippedTargets.length}/${selection.targets.length} target(s) improved; ` +
      `primary ${firstShipped.repoRelativeFilePath}: ${firstShipped.coverageBefore.line.toFixed(1)} → ${firstAfter.line.toFixed(1)}\n`,
  );
  return 0;
}

export function collectTestFilesForValidation(
  repoRelativePaths: readonly string[],
  testFilePatterns: readonly RegExp[],
): string[] {
  return repoRelativePaths.filter((path) => testFilePatterns.some((pattern) => pattern.test(path)));
}

function abort(config: CoverageAgentConfig, reason: string): number {
  process.stderr.write(`[validate] ABORT: ${reason}\n`);
  writePartialRunRecord(config, "aborted_quality", {});
  return 1;
}

function writePartialRunRecord(
  config: CoverageAgentConfig,
  outcome: ValidateOutcome | "aborted_quality",
  extras: Record<string, unknown>,
): void {
  const payload = {
    outcome: outcome === "ok" ? "pr_opened" : outcome,
    ...extras,
  };
  writeFileSync(config.runRecordPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * Decides whether a non-zero vitest exit should be tolerated because the
 * only failing tests are the ones the agent declared as suspected-bug
 * tests. This is the heart of the "red CI by design, PR still opens" flow.
 *
 * Strict semantics:
 *   - The JSON reporter must have produced at least one test result. If
 *     `tests` is empty, vitest errored before running (compile error, import
 *     error, etc.) — we bail loud rather than paper over it.
 *   - There must be at least one `suspectedBugs` entry. An empty array with
 *     failing tests means the agent either lied or didn't declare them —
 *     abort.
 *   - Every failing test name MUST appear in `suspectedBugs.testName`.
 *     Extra, undeclared failures abort.
 *   - Every `suspectedBugs.testName` MUST appear in the failing set. A
 *     suspectedBugs entry that isn't actually failing is a liar entry —
 *     abort. This forces the declaration to correspond to real failures.
 */
const DECLARE_HINT =
  'If a failure reveals a real source bug, rename the test to end with "(suspected bug: <reason>)" to declare it; otherwise fix the test.';

export function gateFailuresAgainstSuspectedBugs(
  tests: readonly VitestTestResult[],
  suspectedBugs: readonly SuspectedBug[],
): { ok: true; expectedFailureCount: number } | { ok: false; reason: string } {
  if (tests.length === 0) {
    return { ok: false, reason: "no structured test results from vitest JSON reporter" };
  }
  const failing = tests.filter((t) => !t.passed).map((t) => t.name);
  if (failing.length === 0) {
    // Shouldn't happen — caller only invokes this when vitest non-zero
    // exited — but be defensive: non-zero exit with no failing tests means
    // something other than a test failure broke the run (suite setup,
    // watch-mode hang, etc.).
    return { ok: false, reason: "vitest non-zero exit but JSON reports zero failing tests" };
  }
  if (suspectedBugs.length === 0) {
    return {
      ok: false,
      reason: `${failing.length} failing test(s) but agent-output.json declared no suspectedBugs. ${DECLARE_HINT}`,
    };
  }
  const declaredNames = new Set(suspectedBugs.map((b) => b.testName));
  const failingNames = new Set(failing);
  const undeclared = [...failingNames].filter((n) => !declaredNames.has(n));
  if (undeclared.length > 0) {
    return {
      ok: false,
      reason: `undeclared failing test(s): ${undeclared.join(", ")}. ${DECLARE_HINT}`,
    };
  }
  const unmatched = [...declaredNames].filter((n) => !failingNames.has(n));
  if (unmatched.length > 0) {
    return {
      ok: false,
      reason: `suspectedBugs entries do not correspond to failing tests: ${unmatched.join(", ")}`,
    };
  }
  return { ok: true, expectedFailureCount: failing.length };
}

function readOptionalMutationScore(path: string): number | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { mutationScore?: number };
    return typeof parsed.mutationScore === "number" ? parsed.mutationScore : null;
  } catch {
    return null;
  }
}
