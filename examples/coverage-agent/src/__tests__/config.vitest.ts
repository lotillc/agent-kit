import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { loadConfig } from "../config.js";

function makeFakeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "coverage-agent-cfg-"));
  mkdirSync(join(dir, ".coverage-agent-run"), { recursive: true });
  return dir;
}

describe("loadConfig worktree marker", () => {
  test("workingTree equals repoRoot when no marker is present", () => {
    const repo = makeFakeRepo();
    const config = loadConfig({
      COVERAGE_AGENT_REPO_ROOT: repo,
      CI: "true",
    });
    expect(config.workingTree).toBe(repo);
    expect(config.runOutputDir).toBe(resolve(repo, ".coverage-agent-run"));
    expect(config.coverageSummaryPath).toBe(resolve(repo, "coverage/coverage-summary.json"));
    expect(config.stackBasePath).toBe(resolve(repo, ".coverage-agent-run/stack-base.json"));
  });

  test("workingTree reads from .coverage-agent-run/.worktree when present", () => {
    const repo = makeFakeRepo();
    const worktree = mkdtempSync(join(tmpdir(), "coverage-agent-wt-"));
    writeFileSync(resolve(repo, ".coverage-agent-run/.worktree"), `${worktree}\n`, "utf8");
    const config = loadConfig({
      COVERAGE_AGENT_REPO_ROOT: repo,
      CI: "true",
    });
    expect(config.workingTree).toBe(worktree);
    expect(config.runOutputDir).toBe(resolve(worktree, ".coverage-agent-run"));
    expect(config.coverageSummaryPath).toBe(resolve(worktree, "coverage/coverage-summary.json"));
    // State + runs log always live in repoRoot regardless of worktree.
  });

  test("isolateMode=auto isolates locally (no CI env)", () => {
    const repo = makeFakeRepo();
    const config = loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo });
    expect(config.shouldIsolate).toBe(true);
  });

  test("isolateMode=auto skips isolation in CI", () => {
    const repo = makeFakeRepo();
    const config = loadConfig({
      COVERAGE_AGENT_REPO_ROOT: repo,
      CI: "true",
    });
    expect(config.shouldIsolate).toBe(false);
  });

  test("isolateMode=always forces isolation even in CI", () => {
    const repo = makeFakeRepo();
    const config = loadConfig({
      COVERAGE_AGENT_REPO_ROOT: repo,
      CI: "true",
      COVERAGE_AGENT_ISOLATE: "always",
    });
    expect(config.shouldIsolate).toBe(true);
  });

  test("isolateMode=never disables isolation locally", () => {
    const repo = makeFakeRepo();
    const config = loadConfig({
      COVERAGE_AGENT_REPO_ROOT: repo,
      COVERAGE_AGENT_ISOLATE: "never",
    });
    expect(config.shouldIsolate).toBe(false);
  });
});

describe("loadConfig dryRun + coverage log", () => {
  test("dryRun defaults false", () => {
    const repo = makeFakeRepo();
    expect(loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo }).dryRun).toBe(false);
  });

  test("COVERAGE_AGENT_DRY_RUN=true sets dryRun", () => {
    const repo = makeFakeRepo();
    expect(
      loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo, COVERAGE_AGENT_DRY_RUN: "true" }).dryRun,
    ).toBe(true);
  });

  test("COVERAGE_AGENT_DRY_RUN=false keeps dryRun false (not JS-truthy)", () => {
    const repo = makeFakeRepo();
    expect(
      loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo, COVERAGE_AGENT_DRY_RUN: "false" }).dryRun,
    ).toBe(false);
  });

  test("keepWorktree defaults true (stale worktree cleaned at next run's start)", () => {
    // Regression fence: prior default tore the worktree down at end-of-run
    // which made post-mortem inspection impossible (PR #2955 was
    // opened-and-torn before the human could look at what the agent did).
    // New contract: keep by default; next run's `clearStaleWorktree` reaps.
    const repo = makeFakeRepo();
    expect(loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo }).keepWorktree).toBe(true);
  });

  test("COVERAGE_AGENT_KEEP_WORKTREE=false forces eager cleanup (CI opt-in)", () => {
    const repo = makeFakeRepo();
    expect(
      loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo, COVERAGE_AGENT_KEEP_WORKTREE: "false" })
        .keepWorktree,
    ).toBe(false);
  });

  test("COVERAGE_AGENT_KEEP_WORKTREE=true explicitly keeps worktree", () => {
    const repo = makeFakeRepo();
    expect(
      loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo, COVERAGE_AGENT_KEEP_WORKTREE: "true" })
        .keepWorktree,
    ).toBe(true);
  });

  test("coverageRunLogPath lives in runOutputDir", () => {
    const repo = makeFakeRepo();
    const config = loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo });
    expect(config.coverageRunLogPath).toBe(resolve(repo, ".coverage-agent-run/coverage-run.log"));
  });
});

describe("loadConfig maxCostUsd + allowedBaseBranches + sandboxBranch", () => {
  test("maxCostUsd defaults to undefined (no cap)", () => {
    const repo = makeFakeRepo();
    expect(loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo }).maxCostUsd).toBeUndefined();
  });

  test("maxCostUsd honors COVERAGE_AGENT_MAX_COST_USD as number", () => {
    const repo = makeFakeRepo();
    expect(
      loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo, COVERAGE_AGENT_MAX_COST_USD: "5.00" })
        .maxCostUsd,
    ).toBe(5);
  });

  test("allowedBaseBranches defaults to [main, coverage-agent/sandbox]", () => {
    const repo = makeFakeRepo();
    expect(loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo }).allowedBaseBranches).toEqual([
      "main",
      "coverage-agent/sandbox",
    ]);
  });

  test("allowedBaseBranches overridable via comma-separated env", () => {
    const repo = makeFakeRepo();
    expect(
      loadConfig({
        COVERAGE_AGENT_REPO_ROOT: repo,
        COVERAGE_AGENT_ALLOWED_BASE_BRANCHES: "main, develop ,release/*",
      }).allowedBaseBranches,
    ).toEqual(["main", "develop", "release/*"]);
  });

  test("sandboxBranch default is 'main' (direct-to-main PRs)", () => {
    const repo = makeFakeRepo();
    expect(loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo }).sandboxBranch).toBe("main");
  });

  test("sandboxBranch respects COVERAGE_AGENT_SANDBOX_BRANCH override", () => {
    const repo = makeFakeRepo();
    expect(
      loadConfig({
        COVERAGE_AGENT_REPO_ROOT: repo,
        COVERAGE_AGENT_SANDBOX_BRANCH: "coverage-agent/sandbox",
      }).sandboxBranch,
    ).toBe("coverage-agent/sandbox");
  });

  test("coverageFinalPath sits next to coverageSummaryPath", () => {
    const repo = makeFakeRepo();
    const config = loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo });
    expect(config.coverageFinalPath).toBe(resolve(repo, "coverage/coverage-final.json"));
  });
});

describe("loadConfig adversarial review", () => {
  test("enableAdversarialReview defaults to true (red-team pass runs by default)", () => {
    const repo = makeFakeRepo();
    expect(loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo }).enableAdversarialReview).toBe(true);
  });

  test("COVERAGE_AGENT_ENABLE_ADVERSARIAL_REVIEW='false' turns the red-team pass off (not JS-truthy)", () => {
    // z.stringbool() is the reason this test exists: z.coerce.boolean()
    // would flip the literal string 'false' to true.
    const repo = makeFakeRepo();
    expect(
      loadConfig({
        COVERAGE_AGENT_REPO_ROOT: repo,
        COVERAGE_AGENT_ENABLE_ADVERSARIAL_REVIEW: "false",
      }).enableAdversarialReview,
    ).toBe(false);
  });

  test("adversarialReviewerModel defaults undefined (falls back to primary model)", () => {
    const repo = makeFakeRepo();
    expect(loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo }).adversarialReviewerModel).toBeUndefined();
  });

  test("adversarialReviewerModel honors COVERAGE_AGENT_ADVERSARIAL_REVIEWER_MODEL", () => {
    const repo = makeFakeRepo();
    expect(
      loadConfig({
        COVERAGE_AGENT_REPO_ROOT: repo,
        COVERAGE_AGENT_ADVERSARIAL_REVIEWER_MODEL: "claude-opus-4-1",
      }).adversarialReviewerModel,
    ).toBe("claude-opus-4-1");
  });
});

describe("loadConfig claudeAuthMode", () => {
  test("auto + no CI → useBareAuth=false (prefer local OAuth)", () => {
    const repo = makeFakeRepo();
    const config = loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo });
    expect(config.claudeAuthMode).toBe("auto");
    expect(config.useBareAuth).toBe(false);
  });

  test("auto + CI=true → useBareAuth=true (deterministic API-key billing)", () => {
    const repo = makeFakeRepo();
    const config = loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo, CI: "true" });
    expect(config.claudeAuthMode).toBe("auto");
    expect(config.useBareAuth).toBe(true);
  });

  test("explicit bare forces useBareAuth=true even locally", () => {
    const repo = makeFakeRepo();
    const config = loadConfig({
      COVERAGE_AGENT_REPO_ROOT: repo,
      COVERAGE_AGENT_CLAUDE_AUTH: "bare",
    });
    expect(config.claudeAuthMode).toBe("bare");
    expect(config.useBareAuth).toBe(true);
  });

  test("explicit oauth forces useBareAuth=false even in CI", () => {
    const repo = makeFakeRepo();
    const config = loadConfig({
      COVERAGE_AGENT_REPO_ROOT: repo,
      CI: "true",
      COVERAGE_AGENT_CLAUDE_AUTH: "oauth",
    });
    expect(config.claudeAuthMode).toBe("oauth");
    expect(config.useBareAuth).toBe(false);
  });
});

describe("loadConfig defaults for batching + stacking", () => {
  test("locBudget defaults to 250", () => {
    const repo = makeFakeRepo();
    expect(loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo }).locBudget).toBe(250);
  });

  test("locBudget overridable", () => {
    const repo = makeFakeRepo();
    expect(
      loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo, COVERAGE_AGENT_LOC_BUDGET: "500" }).locBudget,
    ).toBe(500);
  });

  test("claudeTimeoutMs defaults to 30 min", () => {
    const repo = makeFakeRepo();
    expect(loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo }).claudeTimeoutMs).toBe(30 * 60 * 1000);
  });

  test("maxStackDepth defaults to 3", () => {
    const repo = makeFakeRepo();
    expect(loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo }).maxStackDepth).toBe(3);
  });

  test("maxStackDepth overridable", () => {
    const repo = makeFakeRepo();
    expect(
      loadConfig({ COVERAGE_AGENT_REPO_ROOT: repo, COVERAGE_AGENT_MAX_STACK_DEPTH: "5" })
        .maxStackDepth,
    ).toBe(5);
  });
});
