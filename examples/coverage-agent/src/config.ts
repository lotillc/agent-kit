import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  type PackageManagerStrategy,
  resolvePackageManagerStrategy,
} from "./runner/packageManagers.js";
import { resolveTestRunnerConfig, type TestRunnerConfig } from "./runner/testRunners.js";

/**
 * True when the repo has no workspace declaration — used to skip per-package
 * vitest-config globbing and synthesize a single repoRoot-scoped package.
 * Checked against:
 *   1. `pnpm-workspace.yaml` (pnpm-specific workspace marker)
 *   2. `"workspaces"` field in root `package.json` (npm/yarn/bun convention)
 * Either present ⇒ monorepo. Neither ⇒ single-package.
 */
function detectSinglePackage(repoRoot: string): boolean {
  if (existsSync(resolve(repoRoot, "pnpm-workspace.yaml"))) return false;
  const pkgPath = resolve(repoRoot, "package.json");
  if (!existsSync(pkgPath)) return true;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { workspaces?: unknown };
    if (pkg.workspaces) return false;
  } catch {
    // Unparseable package.json ⇒ treat as single-package; the worse thing
    // that happens is the agent scores one synthetic package against nothing,
    // which is graceful degradation.
  }
  return true;
}

function detectRepoRoot(cwd: string): string {
  // `git rev-parse --show-toplevel` returns the absolute repo root regardless
  // of where inside the worktree the command runs — which matters because
  // `pnpm --filter` runs in the package dir, not the repo root.
  const res = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  });
  if (res.status === 0 && res.stdout.trim()) {
    return res.stdout.trim();
  }
  return cwd;
}

/**
 * Parse the `allowedBaseBranches` list. When the env var is not set, default
 * to `main,coverage-agent/sandbox` and additionally include the detected
 * current branch so local runs on a feature branch don't trip the safety
 * check. When the env var IS set the user's list is used verbatim — no
 * auto-add, since they've taken explicit control.
 */
function resolveAllowedBaseBranches(
  envValue: string | undefined,
  detectedBranch: string | null,
): string[] {
  const raw = envValue ?? "main,coverage-agent/sandbox";
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (envValue !== undefined) return parsed;
  if (detectedBranch && !parsed.includes(detectedBranch)) parsed.push(detectedBranch);
  return parsed;
}

/**
 * Current branch name at `repoRoot`, or null if detached / not a git repo /
 * unknown. Used as the default PR base so local runs from a feature branch
 * stack onto that branch instead of jumping straight to `main`. Returns null
 * on detached-HEAD so the caller can fall back to "main".
 */
function detectCurrentBranch(repoRoot: string): string | null {
  const res = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (res.status !== 0) return null;
  const name = res.stdout.trim();
  if (!name || name === "HEAD") return null;
  return name;
}

const EnvSchema = z.object({
  GITHUB_WORKSPACE: z.string().optional(),
  CI: z.string().optional(),
  COVERAGE_AGENT_REPO_ROOT: z.string().optional(),
  COVERAGE_AGENT_SANDBOX_BRANCH: z.string().optional(),
  COVERAGE_AGENT_MAX_ITERATIONS: z.coerce.number().int().positive().optional(),
  COVERAGE_AGENT_FLAKE_RUNS: z.coerce.number().int().positive().optional(),
  COVERAGE_AGENT_CLAUDE_MAX_TURNS: z.coerce.number().int().positive().optional(),
  COVERAGE_AGENT_CLAUDE_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  COVERAGE_AGENT_CLAUDE_MODEL: z.string().optional(),
  COVERAGE_AGENT_ISOLATE: z.enum(["auto", "always", "never"]).optional(),
  // z.stringbool (Zod 4) — parses "true"/"false"/"1"/"0"/etc. correctly.
  // Using z.coerce.boolean here would turn the literal string "false" into
  // true (JS truthiness), silently inverting the workflow's dry-run flag.
  COVERAGE_AGENT_KEEP_WORKTREE: z.stringbool().optional(),
  COVERAGE_AGENT_DRY_RUN: z.stringbool().optional(),
  COVERAGE_AGENT_REVIEWERS: z.string().optional(),
  COVERAGE_AGENT_REVIEWER_MODEL: z.string().optional(),
  /** Run a red-team-framed 2nd reviewer pass after the primary. Default true. */
  COVERAGE_AGENT_ENABLE_ADVERSARIAL_REVIEW: z.stringbool().optional(),
  /** Model for the adversarial pass. Unset ⇒ same as `COVERAGE_AGENT_REVIEWER_MODEL`. */
  COVERAGE_AGENT_ADVERSARIAL_REVIEWER_MODEL: z.string().optional(),
  COVERAGE_AGENT_REVIEW_MAX_TURNS: z.coerce.number().int().positive().optional(),
  COVERAGE_AGENT_FIX_MAX_TURNS: z.coerce.number().int().positive().optional(),
  COVERAGE_AGENT_LOC_BUDGET: z.coerce.number().int().positive().optional(),
  /**
   * Max number of files per run. Selection caps `targets[]` at this count
   * even when the LoC budget would allow more. Default 3. Either cap
   * triggering stops selection ("min(N files, LoC budget)").
   */
  COVERAGE_AGENT_MAX_FILES_PER_RUN: z.coerce.number().int().positive().optional(),
  COVERAGE_AGENT_MAX_STACK_DEPTH: z.coerce.number().int().positive().optional(),
  COVERAGE_AGENT_UPSTREAM_REF: z.string().optional(),
  /**
   * Per-run cost cap in USD. Enforced post-hoc after the agent returns;
   * stream-json emits `total_cost_usd` only on the final event, so mid-flight
   * kills aren't possible.
   */
  COVERAGE_AGENT_MAX_COST_USD: z.coerce.number().nonnegative().optional(),
  /** Comma-separated base-branch allowlist for `open-pr`. Default `main,coverage-agent/sandbox`. */
  COVERAGE_AGENT_ALLOWED_BASE_BRANCHES: z.string().optional(),
  /** Package-manager key. Only `pnpm` is implemented; others throw. */
  COVERAGE_AGENT_PACKAGE_MANAGER: z.string().optional(),
  /** Test-runner key. Only `vitest` is implemented; others throw. */
  COVERAGE_AGENT_TEST_RUNNER: z.string().optional(),
  /**
   * Claude Code auth mode.
   *   "auto" (default): `--bare` in CI, oauth locally.
   *   "bare":  always `--bare`; uses ANTHROPIC_API_KEY, ignores cached OAuth.
   *   "oauth": never `--bare`; uses `claude login` credentials.
   */
  COVERAGE_AGENT_CLAUDE_AUTH: z.enum(["auto", "bare", "oauth"]).optional(),
  /**
   * Repo-specific preflight script (argv[2] = worktree path). Runs in the
   * ephemeral worktree before Claude is invoked. Unset ⇒
   * `pnpm install --frozen-lockfile --prefer-offline`.
   */
  COVERAGE_AGENT_PREFLIGHT_SCRIPT: z.string().optional(),
  /** Timeout for the worktree preflight step. Default 5 min. */
  COVERAGE_AGENT_PREFLIGHT_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  GITHUB_SERVER_URL: z.string().optional(),
  GITHUB_REPOSITORY: z.string().optional(),
  GITHUB_RUN_ID: z.string().optional(),
});

export type CoverageAgentConfig = {
  /** The main repo checkout. Always the source of truth for state.json and runs.jsonl. */
  repoRoot: string;
  /**
   * The directory where git / vitest / stryker / gh commands run. Equals
   * repoRoot in CI. When invoke-claude created an ephemeral worktree (local
   * dev) it points there instead, so validate and open-pr operate on the
   * agent's output rather than the user's working branch.
   */
  workingTree: string;
  /** Run artifacts — under workingTree so they're co-located with generated code. */
  runOutputDir: string;
  coverageSummaryPath: string;
  /** Istanbul per-line coverage output — sibling of coverageSummaryPath. */
  coverageFinalPath: string;
  selectionJsonPath: string;
  /**
   * Persisted stack-base resolution (base branch + SHA the worktree forked
   * from). Written by `invoke-claude` before worktree creation; read by
   * `open-pr` so the PR base branch matches the worktree's actual fork
   * point even if another coverage-agent PR opened between the two
   * commands.
   */
  stackBasePath: string;
  claudeStatsPath: string;
  /**
   * Fix-turn stats artifact. Written only when the post-review fix-turn
   * actually runs. Aggregated into the PR body by `open-pr` so cost/tokens
   * reflect the full per-file spend (invoke-claude + reviewers + fix-turn),
   * not just invoke-claude.
   */
  fixTurnStatsPath: string;
  agentOutputPath: string;
  metricsPath: string;
  runRecordPath: string;
  strykerBeforeJsonPath: string;
  strykerAfterJsonPath: string;
  antiPatternLintConfigPath: string;
  /** Marker file in main repoRoot recording an active worktree path. */
  worktreeMarkerPath: string;
  sandboxBranch: string;
  maxIterations: number;
  flakeRuns: number;
  maxClaudeTurns: number;
  claudeTimeoutMs: number;
  claudeModel: string | undefined;
  /**
   * "auto" (default): isolate via an ephemeral worktree when running locally,
   * trust the ephemeral CI runner when CI=true.
   * "always": always isolate. "never": always run in-place.
   */
  isolateMode: "auto" | "always" | "never";
  /** When true, do not remove the worktree after invoke-claude completes. */
  keepWorktree: boolean;
  /** Derived: whether this run should isolate. */
  shouldIsolate: boolean;
  /**
   * Dry-run: pipeline runs select + doctor, then short-circuits to a
   * `dry_run` outcome. Used for cheap workflow-plumbing verification.
   */
  dryRun: boolean;
  /** Path to the log file capturing `pnpm test:coverage` output. */
  coverageRunLogPath: string;
  /** Review artifact path — reviewer(s) write here. */
  reviewPath: string;
  /**
   * Dropped-findings artifact path. Populated by the pipeline when the
   * reviewer blocks a test after a failed fix-turn; consumed by open-pr to
   * surface the findings in the PR body.
   */
  droppedFindingsPath: string;
  /** Names of reviewer impls to invoke. Default: ["claude"]. */
  reviewerNames: string[];
  /** Model override for the default ClaudeReviewer. */
  reviewerModel: string | undefined;
  /**
   * Whether to run a red-team 2nd-pass reviewer after the primary. Default
   * true. See `buildAdversarialReviewerPrompt.ts` for why this exists.
   */
  enableAdversarialReview: boolean;
  /**
   * Model override specifically for the adversarial 2nd-pass. Unset =
   * fall back to `reviewerModel`, since framing (not capability) is what
   * we're fixing.
   */
  adversarialReviewerModel: string | undefined;
  /** Turn cap for each reviewer session. */
  reviewMaxTurns: number;
  /** Turn cap for the post-review fix turn (step 4). */
  fixMaxTurns: number;
  /**
   * Budget, in uncovered lines, for a single agent run. Selection peels files
   * off the ranked candidate list until sum >= budget (always picks at least
   * one file). Default 250 — tight enough that the bucket binds before
   * `maxFilesPerRun` for typical large CLI targets, so a 60-turn Claude
   * session focuses on 1-2 files instead of running out on 3.
   */
  locBudget: number;
  /**
   * Max number of files in one run's `selection.targets[]`. Selection peels
   * files off the ranked candidates until EITHER this count OR `locBudget`
   * is reached ("min(N, LoC)"). Default 3 — conservative enough that one
   * Claude generation session can cover every target without quality drop;
   * raise after a few batched runs validate the amortization savings.
   */
  maxFilesPerRun: number;
  /** Upper bound on open coverage-agent PRs before we skip the run. */
  maxStackDepth: number;
  /** Ref representing the tip of main — used as ancestry lower bound. */
  upstreamRef: string;
  prLabel: string;
  workflowRunUrl: string;
  /** Repo-specific preflight script; undefined = use built-in pnpm install. */
  preflightScript: string | undefined;
  preflightTimeoutMs: number;
  /**
   * Per-run cost cap in USD. `undefined` = no cap. invoke-claude aborts
   * non-zero when post-run `totalCostUsd` exceeds this (post-hoc only).
   */
  maxCostUsd: number | undefined;
  /**
   * Allowed base branches for `gh pr create`. Derived from
   * COVERAGE_AGENT_ALLOWED_BASE_BRANCHES or default.
   */
  allowedBaseBranches: string[];
  /**
   * Mode for Claude Code auth resolution (see env schema for semantics).
   */
  claudeAuthMode: "auto" | "bare" | "oauth";
  /**
   * Derived: should `--bare` be passed on the Claude Code spawn? true =
   * force ANTHROPIC_API_KEY; false = allow the cached OAuth session.
   */
  useBareAuth: boolean;
  /** Package manager strategy (install/test/coverage commands). */
  packageManager: PackageManagerStrategy;
  /** Test runner shape (file suffix, layout, patterns). */
  testRunner: TestRunnerConfig;
  /**
   * Derived: true when the repo has no workspace manifest (no pnpm-workspace.yaml
   * and no `workspaces` in package.json). In single-package mode the
   * selection pipeline synthesizes one package rooted at repoRoot instead
   * of globbing for vitest configs.
   */
  isSinglePackage: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CoverageAgentConfig {
  const parsed = EnvSchema.parse(env);
  const repoRoot =
    parsed.COVERAGE_AGENT_REPO_ROOT ?? parsed.GITHUB_WORKSPACE ?? detectRepoRoot(process.cwd());
  // Active-worktree marker: when invoke-claude has created one, later
  // commands (validate, open-pr) operate there instead of repoRoot.
  const worktreeMarkerPath = resolve(repoRoot, ".coverage-agent-run", ".worktree");
  const markedWorktree =
    existsSync(worktreeMarkerPath) && readFileSync(worktreeMarkerPath, "utf8").trim();
  const workingTree = markedWorktree || repoRoot;
  const runOutputDir = resolve(workingTree, ".coverage-agent-run");
  // Persistent output dir at repoRoot. Holds artifacts that must survive
  // ephemeral-worktree teardown (e.g. run-record.json is consumed by the
  // `summary` command and CI post-processing after open-pr tears down the
  // worktree).
  const persistentOutputDir = resolve(repoRoot, ".coverage-agent-run");
  const serverUrl = parsed.GITHUB_SERVER_URL ?? "https://github.com";
  const workflowRunUrl =
    parsed.GITHUB_REPOSITORY && parsed.GITHUB_RUN_ID
      ? `${serverUrl}/${parsed.GITHUB_REPOSITORY}/actions/runs/${parsed.GITHUB_RUN_ID}`
      : "";
  const isCi = parsed.CI === "true" || Boolean(parsed.GITHUB_WORKSPACE);
  const isolateMode = parsed.COVERAGE_AGENT_ISOLATE ?? "auto";
  const shouldIsolate = isolateMode === "always" || (isolateMode === "auto" && !isCi);
  const claudeAuthMode = parsed.COVERAGE_AGENT_CLAUDE_AUTH ?? "auto";
  // Default: CI uses API-key-only (deterministic billing); local dev uses
  // whichever account `claude login` was last run with, so a developer's
  // own subscription/credits fund the run by default.
  const useBareAuth = claudeAuthMode === "bare" || (claudeAuthMode === "auto" && isCi);
  const packageManager = resolvePackageManagerStrategy(parsed.COVERAGE_AGENT_PACKAGE_MANAGER);
  const testRunner = resolveTestRunnerConfig(parsed.COVERAGE_AGENT_TEST_RUNNER);
  // Single-package: no workspace manifest present. Checked against repoRoot,
  // not workingTree, so an ephemeral worktree still inherits the signal.
  const isSinglePackage = detectSinglePackage(repoRoot);
  // Default the PR base to the branch that invoked the pipeline. In CI
  // that resolves to "main" (or the sandbox branch); locally, running from
  // a feature branch stacks new coverage PRs onto that branch instead of
  // jumping to main. Falls back to "main" on detached HEAD / non-git dirs.
  const detectedBranch = detectCurrentBranch(repoRoot);
  const defaultSandboxBranch = detectedBranch ?? "main";
  return {
    repoRoot,
    workingTree,
    runOutputDir,
    coverageSummaryPath: resolve(workingTree, "coverage/coverage-summary.json"),
    coverageFinalPath: resolve(workingTree, "coverage/coverage-final.json"),
    selectionJsonPath: resolve(runOutputDir, "selection.json"),
    stackBasePath: resolve(runOutputDir, "stack-base.json"),
    claudeStatsPath: resolve(runOutputDir, "claude-stats.json"),
    fixTurnStatsPath: resolve(runOutputDir, "fix-turn-stats.json"),
    agentOutputPath: resolve(runOutputDir, "agent-output.json"),
    metricsPath: resolve(runOutputDir, "metrics.json"),
    runRecordPath: resolve(persistentOutputDir, "run-record.json"),
    strykerBeforeJsonPath: resolve(runOutputDir, "stryker-before.json"),
    strykerAfterJsonPath: resolve(runOutputDir, "stryker-after.json"),
    antiPatternLintConfigPath: resolve(runOutputDir, "eslint.gate.config.mjs"),
    worktreeMarkerPath,
    // Base the fallback-base-branch on the invoking branch (detected above),
    // falling back to "main" when detection fails. Stacking still takes
    // precedence when another coverage-agent PR is open (see
    // stack/resolveStackBase). Override via COVERAGE_AGENT_SANDBOX_BRANCH if
    // you want to run against a specific branch (e.g. `coverage-agent/sandbox`).
    sandboxBranch: parsed.COVERAGE_AGENT_SANDBOX_BRANCH ?? defaultSandboxBranch,
    maxIterations: parsed.COVERAGE_AGENT_MAX_ITERATIONS ?? 3,
    flakeRuns: parsed.COVERAGE_AGENT_FLAKE_RUNS ?? 5,
    // Turns cap is a safety net, not the budget. Real budget is claudeTimeoutMs.
    // Raise via env for hard files (side-effect-heavy) or drop to 15 for cheap
    // first-pass dry runs. Merlin sets no cap at all; we keep one as a
    // defense-in-depth against runaway loops.
    maxClaudeTurns: parsed.COVERAGE_AGENT_CLAUDE_MAX_TURNS ?? 60,
    claudeTimeoutMs: parsed.COVERAGE_AGENT_CLAUDE_TIMEOUT_MS ?? 30 * 60 * 1000,
    claudeModel: parsed.COVERAGE_AGENT_CLAUDE_MODEL,
    isolateMode,
    // Controls whether open-pr tears the worktree down on success. Default
    // TRUE: keep the worktree so a human can inspect what the agent did
    // after the PR is open. The next pipeline run clears any stale worktree
    // at start via `clearStaleWorktree`, so accumulated /tmp/agent-kit-wt-*
    // directories get reaped on the next invocation. Set
    // COVERAGE_AGENT_KEEP_WORKTREE=false to tear down eagerly (e.g. in CI).
    keepWorktree: parsed.COVERAGE_AGENT_KEEP_WORKTREE ?? true,
    shouldIsolate,
    dryRun: parsed.COVERAGE_AGENT_DRY_RUN ?? false,
    coverageRunLogPath: resolve(runOutputDir, "coverage-run.log"),
    reviewPath: resolve(runOutputDir, "review.json"),
    droppedFindingsPath: resolve(runOutputDir, "dropped-findings.json"),
    reviewerNames: (parsed.COVERAGE_AGENT_REVIEWERS ?? "claude")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    reviewerModel: parsed.COVERAGE_AGENT_REVIEWER_MODEL,
    enableAdversarialReview: parsed.COVERAGE_AGENT_ENABLE_ADVERSARIAL_REVIEW ?? true,
    adversarialReviewerModel: parsed.COVERAGE_AGENT_ADVERSARIAL_REVIEWER_MODEL,
    reviewMaxTurns: parsed.COVERAGE_AGENT_REVIEW_MAX_TURNS ?? 8,
    fixMaxTurns: parsed.COVERAGE_AGENT_FIX_MAX_TURNS ?? 10,
    locBudget: parsed.COVERAGE_AGENT_LOC_BUDGET ?? 250,
    maxFilesPerRun: parsed.COVERAGE_AGENT_MAX_FILES_PER_RUN ?? 3,
    maxStackDepth: parsed.COVERAGE_AGENT_MAX_STACK_DEPTH ?? 3,
    upstreamRef: parsed.COVERAGE_AGENT_UPSTREAM_REF ?? "origin/main",
    prLabel: "coverage-agent",
    workflowRunUrl,
    preflightScript: parsed.COVERAGE_AGENT_PREFLIGHT_SCRIPT,
    preflightTimeoutMs: parsed.COVERAGE_AGENT_PREFLIGHT_TIMEOUT_MS ?? 5 * 60 * 1000,
    claudeAuthMode,
    useBareAuth,
    packageManager,
    testRunner,
    isSinglePackage,
    maxCostUsd: parsed.COVERAGE_AGENT_MAX_COST_USD,
    allowedBaseBranches: resolveAllowedBaseBranches(
      parsed.COVERAGE_AGENT_ALLOWED_BASE_BRANCHES,
      detectedBranch,
    ),
  };
}
