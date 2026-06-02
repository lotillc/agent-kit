import { describe, expect, test } from "vitest";

import {
  mergeReviewArtifacts,
  type ReviewArtifact,
  type ReviewFinding,
  type ReviewSeverity,
} from "../review/reviewer.js";

function artifact(
  reviewerName: string,
  findings: ReviewFinding[],
  extras: Partial<ReviewArtifact> = {},
): ReviewArtifact {
  return {
    reviewerName,
    durationMs: 0,
    findings,
    ...extras,
  };
}

function finding(
  file: string,
  line: number | undefined,
  severity: ReviewSeverity,
  issue: string,
  suggestion?: string,
): ReviewFinding {
  return { file, line, severity, issue, ...(suggestion ? { suggestion } : {}) };
}

describe("mergeReviewArtifacts", () => {
  test("single-artifact passthrough: returns the input unchanged", () => {
    const only = artifact("claude", [finding("a.ts", 10, "critical", "x")]);
    const merged = mergeReviewArtifacts([only]);
    expect(merged).toBe(only);
  });

  test("empty artifacts array returns a 'none' artifact with no findings", () => {
    const merged = mergeReviewArtifacts([]);
    expect(merged.reviewerName).toBe("none");
    expect(merged.findings).toEqual([]);
    expect(merged.summary).toContain("no reviewers configured");
  });

  test("distinct findings across reviewers are concatenated in order", () => {
    const primary = artifact("claude", [finding("a.ts", 1, "medium", "alpha")]);
    const adversarial = artifact("claude-adversarial", [finding("b.ts", 2, "critical", "beta")]);
    const merged = mergeReviewArtifacts([primary, adversarial]);
    expect(merged.findings).toHaveLength(2);
    expect(merged.findings[0]?.file).toBe("a.ts");
    expect(merged.findings[1]?.file).toBe("b.ts");
    expect(merged.reviewerName).toBe("claude,claude-adversarial");
  });

  test("same file+line+issue collides; severity is max-wins (adversarial CRITICAL beats primary MEDIUM)", () => {
    // This is THE load-bearing case for the adversarial pass: the
    // primary flagged a bug-pin as medium, the adversarial reviewer
    // re-flagged the same file/line as critical to force fix-turn to
    // run. After the merge there must be ONE finding at CRITICAL.
    const primary = artifact("claude", [
      finding("audit-aws-resources.vitest.ts", 108, "medium", "pins wrong secret token"),
    ]);
    const adversarial = artifact("claude-adversarial", [
      finding("audit-aws-resources.vitest.ts", 108, "critical", "pins wrong secret token"),
    ]);
    const merged = mergeReviewArtifacts([primary, adversarial]);
    expect(merged.findings).toHaveLength(1);
    expect(merged.findings[0]?.severity).toBe("critical");
  });

  test("max-wins is symmetric regardless of order (primary CRITICAL, adversarial MEDIUM still yields CRITICAL)", () => {
    const primary = artifact("claude", [finding("a.ts", 5, "critical", "x")]);
    const adversarial = artifact("claude-adversarial", [finding("a.ts", 5, "medium", "x")]);
    const merged = mergeReviewArtifacts([primary, adversarial]);
    expect(merged.findings).toHaveLength(1);
    expect(merged.findings[0]?.severity).toBe("critical");
  });

  test("later artifact's wording wins on issue/suggestion when issues normalize-equal", () => {
    // Deliberate: the adversarial reviewer has run the bug-pin flag with
    // better wording ("pins resource-type token" vs "wrong token"); its
    // suggestion is the one that should end up in the PR body.
    const primary = artifact("claude", [
      finding("a.ts", 5, "medium", "WRONG TOKEN", "suggest primary"),
    ]);
    const adversarial = artifact("claude-adversarial", [
      finding("a.ts", 5, "critical", "wrong  token", "suggest adversarial"),
    ]);
    const merged = mergeReviewArtifacts([primary, adversarial]);
    expect(merged.findings).toHaveLength(1);
    expect(merged.findings[0]?.severity).toBe("critical");
    // Adversarial wording (cleaner, stronger) wins.
    expect(merged.findings[0]?.suggestion).toBe("suggest adversarial");
    expect(merged.findings[0]?.issue).toBe("wrong  token");
  });

  test("wording always tracks the later artifact even when its severity is LOWER (severity is the only field that max-wins)", () => {
    // Symmetric counter-case to "later artifact's wording wins on
    // issue/suggestion" above. Here the primary is already the stricter
    // CRITICAL; the adversarial only piled on at MEDIUM with different
    // wording. Current semantics: severity is taken as max (→ critical),
    // but wording/suggestion always track the LAST artifact in the input
    // array, regardless of which artifact's severity won. This test pins
    // that design choice — if we later decide wording should track the
    // severity winner, this test is the knob to flip.
    const primary = artifact("claude", [
      finding("a.ts", 5, "critical", "PRIMARY wording", "suggest primary"),
    ]);
    const adversarial = artifact("claude-adversarial", [
      finding("a.ts", 5, "medium", "primary  wording", "suggest adversarial"),
    ]);
    const merged = mergeReviewArtifacts([primary, adversarial]);
    expect(merged.findings).toHaveLength(1);
    expect(merged.findings[0]?.severity).toBe("critical");
    // Adversarial was later in the input → its wording wins, regardless of
    // severity. Keep this explicit so a future "wording tracks severity
    // winner" refactor has to consciously flip this assertion.
    expect(merged.findings[0]?.issue).toBe("primary  wording");
    expect(merged.findings[0]?.suggestion).toBe("suggest adversarial");
  });

  test("line is part of the dedupe key — same file + same issue on different lines stays distinct", () => {
    const primary = artifact("claude", [finding("a.ts", 10, "medium", "issue A")]);
    const adversarial = artifact("claude-adversarial", [
      finding("a.ts", 20, "critical", "issue A"),
    ]);
    const merged = mergeReviewArtifacts([primary, adversarial]);
    expect(merged.findings).toHaveLength(2);
    expect(merged.findings.map((f) => f.line).sort()).toEqual([10, 20]);
  });

  test("undefined line collapses to the same bucket as other undefined-line findings", () => {
    // Findings without a line number are rare but valid per the Zod
    // schema. Two of them on the same file with the same issue should
    // still dedupe so we don't double-ship.
    const primary = artifact("claude", [finding("a.ts", undefined, "medium", "same issue")]);
    const adversarial = artifact("claude-adversarial", [
      finding("a.ts", undefined, "high", "same issue"),
    ]);
    const merged = mergeReviewArtifacts([primary, adversarial]);
    expect(merged.findings).toHaveLength(1);
    expect(merged.findings[0]?.severity).toBe("high");
  });

  test("issue normalization ignores whitespace + case so trivial wording differences still dedupe", () => {
    const primary = artifact("claude", [finding("a.ts", 1, "medium", "Pins  Wrong\tToken Shape")]);
    const adversarial = artifact("claude-adversarial", [
      finding("a.ts", 1, "critical", "  pins wrong token shape "),
    ]);
    const merged = mergeReviewArtifacts([primary, adversarial]);
    expect(merged.findings).toHaveLength(1);
    expect(merged.findings[0]?.severity).toBe("critical");
  });

  test("totalCostUsd sums across reviewers and is undefined when nobody reported cost", () => {
    const a = artifact("claude", [], { durationMs: 100, totalCostUsd: 0.3 });
    const b = artifact("claude-adversarial", [], { durationMs: 200, totalCostUsd: 0.4 });
    const merged = mergeReviewArtifacts([a, b]);
    expect(merged.totalCostUsd).toBeCloseTo(0.7);
    expect(merged.durationMs).toBe(300);

    const c = artifact("claude", [], { durationMs: 100 });
    const d = artifact("claude-adversarial", [], { durationMs: 50 });
    const mergedNoCost = mergeReviewArtifacts([c, d]);
    expect(mergedNoCost.totalCostUsd).toBeUndefined();
  });

  test("sums token fields across reviewers; undefined when nobody reported the field", () => {
    // Tokens must flow through the merge so open-pr can aggregate total
    // footprint across invoke-claude + reviewers + fix-turn. `undefined`
    // when nobody reported the field (rather than `0`) preserves the
    // distinction between "no telemetry" and "legitimate zero" upstream.
    const primary = artifact("claude", [], {
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 5000,
      cacheCreationTokens: 300,
      totalCostUsd: 0.3,
    });
    const adversarial = artifact("claude-adversarial", [], {
      inputTokens: 50,
      outputTokens: 80,
      cacheReadTokens: 2000,
      cacheCreationTokens: 100,
      totalCostUsd: 0.4,
    });
    const merged = mergeReviewArtifacts([primary, adversarial]);
    expect(merged.inputTokens).toBe(150);
    expect(merged.outputTokens).toBe(280);
    expect(merged.cacheReadTokens).toBe(7000);
    expect(merged.cacheCreationTokens).toBe(400);

    const a = artifact("claude", []);
    const b = artifact("claude-adversarial", []);
    const mergedBlank = mergeReviewArtifacts([a, b]);
    expect(mergedBlank.inputTokens).toBeUndefined();
    expect(mergedBlank.outputTokens).toBeUndefined();
    expect(mergedBlank.cacheReadTokens).toBeUndefined();
    expect(mergedBlank.cacheCreationTokens).toBeUndefined();
  });

  test("preserves per-reviewer summaries prefixed with their name in the merged summary", () => {
    const a = artifact("claude", [], { summary: "primary ok" });
    const b = artifact("claude-adversarial", [], { summary: "primary findings appear complete" });
    const merged = mergeReviewArtifacts([a, b]);
    expect(merged.summary).toContain("[claude] primary ok");
    expect(merged.summary).toContain("[claude-adversarial] primary findings appear complete");
  });
});
