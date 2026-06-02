import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";

import type { SpawnFn } from "@lotiai/agent-kit/ports";
import { defaultSpawn } from "@lotiai/agent-kit/process";

export type VitestRunOptions = {
  packageFilter: string;
  /** Absolute path to the test file. */
  testFile: string;
  /**
   * Absolute path to the package directory (`tools/cli`, `packages/foo`, etc.).
   * When supplied, `testFile` is converted to a path relative to this dir
   * before being passed to vitest — required because `pnpm --filter <pkg> exec`
   * cd's into the package dir, and vitest's positional filter matches against
   * the discovered file paths (which are relative to vitest's `root`, i.e.
   * the package dir). Absolute paths have been observed to silently miss all
   * files in vitest 4.x, producing "No test files found".
   */
  packageDir?: string;
  cwd: string;
  spawn?: SpawnFn;
  /**
   * When set, vitest is invoked with `--reporter=json --outputFile=<path>` so
   * the caller can read structured per-test pass/fail info from the returned
   * `tests` array. The file at this path will be overwritten on each call.
   * Left unset by default to preserve the zero-allocation default-reporter
   * path used by flake-check and basic "did the suite pass" gates.
   */
  jsonOutputPath?: string;
};

export type VitestTestResult = {
  /**
   * The `title` passed to `test(...)`/`it(...)` — NOT the fully-qualified
   * (`describe > describe > title`) path. We name-match this against
   * `suspectedBugs[].testName` in the validate gate, and the agent-output
   * contract specifies the bare test-name as the match key.
   */
  name: string;
  passed: boolean;
};

export type VitestRunResult = {
  passed: boolean;
  /** null when the child was killed by a signal (see `@lotiai/agent-kit/ports` SpawnResult). */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /**
   * Per-test results. Populated only when `jsonOutputPath` is set AND the
   * resulting JSON file parses cleanly. When absent/unparseable this is an
   * empty array, so the caller MUST distinguish "ran with json reporter but
   * no tests ran" (empty + passed=false) from "ran without json reporter"
   * (also empty) by checking whether `jsonOutputPath` was supplied.
   */
  tests: VitestTestResult[];
  /**
   * Matched substrings from `VITEST_ANTI_PATTERN_WARNINGS` found in stderr.
   * Empty when clean. Vitest 4 emits these warnings but still exits 0 on a
   * passing run, so callers must gate on this field explicitly.
   */
  antiPatternWarnings: string[];
};

/**
 * Vitest stderr warnings that should abort the run. Exported so regression
 * fences can pin the exact strings — if vitest changes the wording, the
 * fence fails instead of silently skipping the check.
 */
export const VITEST_ANTI_PATTERN_WARNINGS: Array<{ id: string; pattern: RegExp }> = [
  {
    // Fires when a mock implementation provided via arrow function is `new`'d
    // at runtime. Substring match keeps minor punctuation drift from defeating
    // the gate.
    id: "arrow-constructor-mock",
    pattern: /vi\.fn\(\) mock did not use ['"]function['"] or ['"]class['"]/,
  },
];

// Minimal shape of vitest's JSON reporter output. We intentionally parse only
// the fields we need so a reporter-format change surfaces as an empty
// `tests` array (→ validate gate treats it as unparseable and falls back to
// abort) rather than a schema-mismatch crash.
interface VitestJsonReport {
  testResults?: Array<{
    assertionResults?: Array<{
      title?: string;
      status?: string;
    }>;
  }>;
}

export function runVitestFile(options: VitestRunOptions): VitestRunResult {
  const spawn = options.spawn ?? defaultSpawn;
  const filterArg =
    options.packageDir && isAbsolute(options.testFile)
      ? relative(options.packageDir, options.testFile)
      : options.testFile;
  const args = ["--filter", options.packageFilter, "exec", "vitest", "run"];
  if (options.jsonOutputPath) {
    args.push("--reporter=json", `--outputFile=${options.jsonOutputPath}`);
  }
  args.push(filterArg);
  const res = spawn("pnpm", args, { cwd: options.cwd });
  const tests = options.jsonOutputPath ? readVitestJsonResults(options.jsonOutputPath) : [];
  return {
    passed: res.exitCode === 0,
    exitCode: res.exitCode,
    stdout: res.stdout,
    stderr: res.stderr,
    tests,
    antiPatternWarnings: detectAntiPatternWarnings(res.stderr),
  };
}

/**
 * Scan vitest stderr for known ship-blocking warnings. Returns the matched
 * warning messages (de-duplicated). Exported for tests.
 */
export function detectAntiPatternWarnings(stderr: string): string[] {
  const hits = new Set<string>();
  for (const { pattern } of VITEST_ANTI_PATTERN_WARNINGS) {
    const match = stderr.match(pattern);
    if (match) hits.add(match[0]);
  }
  return [...hits];
}

// Flake check: re-run a single test file N times; all must pass. We loop
// the whole vitest invocation because vitest 4.x removed the `--repeat`
// CLI flag that earlier versions supported.
export function runFlakeCheck(options: VitestRunOptions, runs: number): VitestRunResult {
  let last: VitestRunResult = {
    passed: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    tests: [],
    antiPatternWarnings: [],
  };
  for (let i = 0; i < runs; i++) {
    last = runVitestFile(options);
    if (!last.passed) return last;
  }
  return last;
}

function readVitestJsonResults(path: string): VitestTestResult[] {
  if (!existsSync(path)) return [];
  let parsed: VitestJsonReport;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as VitestJsonReport;
  } catch {
    return [];
  }
  const out: VitestTestResult[] = [];
  for (const suite of parsed.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      if (typeof assertion.title !== "string") continue;
      out.push({
        name: assertion.title,
        passed: assertion.status === "passed",
      });
    }
  }
  return out;
}
