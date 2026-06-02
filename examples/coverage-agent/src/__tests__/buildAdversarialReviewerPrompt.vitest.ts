import { describe, expect, test } from "vitest";

import {
  ADVERSARIAL_REVIEW_JSON_BASENAME,
  buildAdversarialReviewerPrompt,
} from "../review/buildAdversarialReviewerPrompt.js";

describe("buildAdversarialReviewerPrompt", () => {
  test("frames the pass as red-team with the explicit bug-pin hypothesis", () => {
    const prompt = buildAdversarialReviewerPrompt({
      diff: "x",
      targets: [],
      workingDir: "/tmp/repo",
      maxTurns: 4,
    });
    expect(prompt).toContain("second reviewer");
    expect(prompt).toContain("red-team");
    // The hypothesis must be named explicitly — if a future edit softens it,
    // the adversarial pass degenerates back into confirmation-biased polite
    // review and PR #2947 repeats.
    expect(prompt).toContain(
      "The primary missed at least one test that pins a buggy source output as if it were correct",
    );
  });

  test("names the exact PR #2947 failure mode as the motivating scar so framing can't be softened blindly", () => {
    const prompt = buildAdversarialReviewerPrompt({
      diff: "x",
      targets: [],
      workingDir: "/tmp",
      maxTurns: 1,
    });
    // Citing the PR number in the prompt is intentional: it's cheap context
    // for the reviewer AND a future-maintainer tripwire — rewriting the
    // adversarial prompt without preserving the scar should feel wrong.
    expect(prompt).toContain("PR #2947");
    expect(prompt).toContain("there's no consumer of the wrong value today");
  });

  test("states that primary runs in parallel and dedupe happens at merge time", () => {
    // The prompt no longer threads prior findings — the adversarial pass
    // runs concurrently with the primary. The model needs to know that so
    // it doesn't try to reason about what the primary might have caught.
    const prompt = buildAdversarialReviewerPrompt({
      diff: "x",
      targets: [],
      workingDir: "/tmp",
      maxTurns: 1,
    });
    expect(prompt).toContain("parallel");
    expect(prompt).toContain("merge step");
  });

  test("does NOT include a 'Prior findings' block (parallel run, no threading)", () => {
    // Regression guard: if a future edit reintroduces prior-findings
    // threading, `runReview` would need to revert to sequential — catch
    // that here before it silently undoes the wall-time win.
    const prompt = buildAdversarialReviewerPrompt({
      diff: "x",
      targets: [],
      workingDir: "/tmp",
      maxTurns: 1,
    });
    expect(prompt).not.toContain("Prior findings (from the primary reviewer)");
    expect(prompt).not.toContain("Add net-new findings only");
  });

  test("tells the reviewer to emit the empty-findings sentinel when nothing is found", () => {
    const prompt = buildAdversarialReviewerPrompt({
      diff: "x",
      targets: [],
      workingDir: "/tmp",
      maxTurns: 1,
    });
    // The sentinel summary is load-bearing: open-pr and any metrics layer
    // can key off this exact string to distinguish "2nd pass ran and
    // had nothing to add" from "2nd pass ran and caught something."
    expect(prompt).toContain('"no adversarial findings"');
  });

  test("permits severity upgrades at the same file+line so mergeReviewArtifacts can take the max", () => {
    const prompt = buildAdversarialReviewerPrompt({
      diff: "x",
      targets: [],
      workingDir: "/tmp",
      maxTurns: 1,
    });
    expect(prompt).toContain("Severity-max-wins");
    expect(prompt).toContain("CRITICAL");
  });

  test("inherits the primary rubric verbatim (no drift)", () => {
    const prompt = buildAdversarialReviewerPrompt({
      diff: "x",
      targets: [],
      workingDir: "/tmp",
      maxTurns: 1,
    });
    // The primary's rubric bullets must appear inside the adversarial
    // prompt — drifting rubrics between the two passes would break the
    // merge/dedupe assumptions.
    expect(prompt).toContain("pins factually incorrect function output");
    expect(prompt).toContain("CRITICAL");
    expect(prompt).toContain("HIGH");
    expect(prompt).toContain("MEDIUM");
    expect(prompt).toContain("LOW");
    expect(prompt).toContain("INFO");
  });

  test("routes output to the adversarial-specific JSON path so the primary's artifact is not clobbered", () => {
    const prompt = buildAdversarialReviewerPrompt({
      diff: "x",
      targets: [],
      workingDir: "/tmp/repo",
      maxTurns: 1,
    });
    // Absolute path to the alt artifact — matches what claudeReviewer
    // reads in adversarial mode.
    expect(prompt).toContain(`/tmp/repo/.coverage-agent-run/${ADVERSARIAL_REVIEW_JSON_BASENAME}`);
    expect(ADVERSARIAL_REVIEW_JSON_BASENAME).toBe("review.adversarial.json");
    // And the plain `review.json` path MUST NOT appear — otherwise the
    // adversarial agent will race the primary on disk.
    expect(prompt).not.toContain("/tmp/repo/.coverage-agent-run/review.json");
  });
});
