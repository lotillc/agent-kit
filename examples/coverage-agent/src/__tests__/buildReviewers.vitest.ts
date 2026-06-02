import { describe, expect, test } from "vitest";
import type { CoverageAgentConfig } from "../config.js";
import { buildReviewers } from "../review/buildReviewers.js";
import { ClaudeReviewer } from "../review/claudeReviewer.js";

function config(overrides: Partial<CoverageAgentConfig> = {}): CoverageAgentConfig {
  return {
    reviewerNames: ["claude"],
    reviewerModel: undefined,
    enableAdversarialReview: true,
    adversarialReviewerModel: undefined,
    ...overrides,
  } as unknown as CoverageAgentConfig;
}

describe("buildReviewers", () => {
  test("returns primary ClaudeReviewer when only 'claude' is configured", () => {
    const { primary } = buildReviewers(config({ reviewerNames: ["claude"] }));
    expect(primary).toBeInstanceOf(ClaudeReviewer);
    // Default name (non-adversarial).
    expect(primary.name).toBe("claude");
  });

  test("enableAdversarialReview=true yields an eagerly-constructed 'claude-adversarial' reviewer", () => {
    const { adversarial } = buildReviewers(config({ enableAdversarialReview: true }));
    expect(adversarial).toBeInstanceOf(ClaudeReviewer);
    expect(adversarial?.name).toBe("claude-adversarial");
  });

  test("enableAdversarialReview=false returns adversarial=undefined", () => {
    const { adversarial } = buildReviewers(config({ enableAdversarialReview: false }));
    expect(adversarial).toBeUndefined();
  });

  test("throws on multiple primary reviewers so legacy multi-reviewer env var can't silently degrade", () => {
    // Defense-in-depth: someone setting COVERAGE_AGENT_REVIEWERS=claude,codex
    // expecting the old concat-all behavior should see a loud error pointing
    // them at enableAdversarialReview, not a silent "only claude ran" surprise.
    expect(() => buildReviewers(config({ reviewerNames: ["claude", "codex"] }))).toThrow(
      /multiple primary reviewers/,
    );
  });

  test("throws on unknown primary reviewer name with a helpful error", () => {
    expect(() => buildReviewers(config({ reviewerNames: ["gemini"] }))).toThrow(
      /unknown reviewer: gemini/,
    );
  });

  test("throws on empty reviewerNames", () => {
    expect(() => buildReviewers(config({ reviewerNames: [] }))).toThrow(
      /at least one reviewer must be configured/,
    );
  });
});
