import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

interface SeverityFinding {
  severity: string;
}

const mocks = vi.hoisted(() => ({
  runFixTurn: vi.fn(),
  runReview: vi.fn(),
  runValidate: vi.fn(),
  readReviewArtifact: vi.fn(),
  writeDroppedFindings: vi.fn(),
  writeDropMarker: vi.fn(),
  writeFixTurnStats: vi.fn(),
  writeReviewArtifact: vi.fn(),
  readSelection: vi.fn(),
  downgradeTargetsByFindings: vi.fn(),
}));

vi.mock("../commands/fixTurn.js", () => ({
  runFixTurn: mocks.runFixTurn,
}));

vi.mock("../commands/review.js", () => ({
  runReview: mocks.runReview,
}));

vi.mock("../commands/validate.js", () => ({
  runValidate: mocks.runValidate,
}));

vi.mock("../artifacts/fixTurnStats.js", () => ({
  writeFixTurnStats: mocks.writeFixTurnStats,
}));

vi.mock("../artifacts/selection.js", () => ({
  readSelection: mocks.readSelection,
}));

vi.mock("../review/droppedFindings.js", () => ({
  writeDroppedFindings: mocks.writeDroppedFindings,
}));

vi.mock("../review/index.js", () => ({
  readReviewArtifact: mocks.readReviewArtifact,
  writeReviewArtifact: mocks.writeReviewArtifact,
}));

vi.mock("../review/writeDropMarker.js", () => ({
  writeDropMarker: mocks.writeDropMarker,
}));

vi.mock("../review/applyFindings.js", () => ({
  downgradeTargetsByFindings: mocks.downgradeTargetsByFindings,
  blockingFindings: (findings: SeverityFinding[]) =>
    findings.filter((f) => f.severity === "critical"),
  addressableFindings: (findings: SeverityFinding[]) =>
    findings.filter((f) => f.severity === "critical" || f.severity === "high"),
}));

import { runReviewAndFixStage } from "../steps/reviewAndFixStep.js";

function makeConfig() {
  const workingTree = mkdtempSync(join(tmpdir(), "coverage-agent-review-stage-"));
  return {
    workingTree,
    fixTurnStatsPath: join(workingTree, "fix-turn-stats.json"),
    reviewPath: join(workingTree, "review.json"),
    droppedFindingsPath: join(workingTree, "dropped-findings.json"),
    selectionJsonPath: join(workingTree, "selection.json"),
  } as never;
}

describe("runReviewAndFixStage", () => {
  test("returns early when review has no blocking findings", async () => {
    mocks.runReview.mockResolvedValue(0);
    mocks.readReviewArtifact.mockReturnValue({
      reviewerName: "claude",
      durationMs: 10,
      findings: [{ file: "a.vitest.ts", severity: "high", issue: "missing branch" }],
    });

    const result = await runReviewAndFixStage(makeConfig());

    expect(result).toEqual({ success: true, droppedAll: false });
    expect(mocks.runReview).toHaveBeenCalledTimes(1);
    expect(mocks.runFixTurn).not.toHaveBeenCalled();
    expect(mocks.runValidate).not.toHaveBeenCalled();
  });

  test("runs fix-turn, revalidate, and rereview when a critical finding is present", async () => {
    const config = makeConfig();
    const critical = { file: "a.vitest.ts", severity: "critical", issue: "pins wrong output" };
    const high = { file: "a.vitest.ts", severity: "high", issue: "missing branch" };

    mocks.runReview.mockResolvedValue(0);
    mocks.readReviewArtifact
      .mockReturnValueOnce({
        reviewerName: "claude",
        durationMs: 10,
        totalCostUsd: 0.1,
        inputTokens: 11,
        outputTokens: 12,
        findings: [critical, high],
      })
      .mockReturnValueOnce({
        reviewerName: "claude",
        durationMs: 20,
        totalCostUsd: 0.2,
        inputTokens: 21,
        outputTokens: 22,
        findings: [high],
      });
    mocks.runFixTurn.mockResolvedValue({
      success: true,
      durationMs: 123,
      totalCostUsd: 0.3,
      numTurns: 2,
      inputTokens: 31,
      outputTokens: 32,
    });
    mocks.runValidate.mockResolvedValue(0);

    const result = await runReviewAndFixStage(config);

    expect(result).toEqual({ success: true, droppedAll: false });
    expect(mocks.runReview).toHaveBeenCalledTimes(2);
    expect(mocks.runFixTurn).toHaveBeenCalledWith([critical, high], config);
    expect(mocks.runValidate).toHaveBeenCalledTimes(1);
    expect(mocks.writeFixTurnStats).toHaveBeenCalledTimes(1);
    expect(mocks.writeReviewArtifact).toHaveBeenCalledTimes(1);
  });

  test("re-runs validate after downgrade so metrics.json matches shipped tests", async () => {
    const config = makeConfig();
    const critical = { file: "a.vitest.ts", severity: "critical", issue: "pins wrong output" };

    mocks.runReview.mockResolvedValue(0);
    // Both reviews surface a critical finding; downgrade leaves surviving tests.
    mocks.readReviewArtifact.mockReturnValue({
      reviewerName: "claude",
      durationMs: 10,
      findings: [critical],
    });
    mocks.runFixTurn.mockResolvedValue({
      success: true,
      durationMs: 1,
      numTurns: 1,
    });
    mocks.runValidate.mockResolvedValue(0);
    mocks.downgradeTargetsByFindings.mockReturnValue({
      downgraded: 1,
      remaining: 1,
      remainingCreated: 1,
      droppedFiles: [],
      partiallyDowngradedFiles: ["a.vitest.ts"],
      droppedByFile: [{ testRepoRel: "a.vitest.ts", findings: [critical] }],
      revertedSourceEdits: [],
    });

    const result = await runReviewAndFixStage(config);

    expect(result).toEqual({ success: true, droppedAll: false });
    // Two runValidate calls: once after fix-turn, once after downgrade.
    expect(mocks.runValidate).toHaveBeenCalledTimes(2);
    expect(mocks.downgradeTargetsByFindings).toHaveBeenCalledTimes(1);
  });

  test("drop-marker branch: skips post-downgrade re-validate (no tests to run)", async () => {
    // When every generated test is dropped, the drop-marker PR ships a marker
    // file in lieu of tests; re-running validate would have nothing to exercise
    // and would fail. Verify we take the drop-marker exit before re-validate.
    const config = makeConfig();
    const critical = { file: "a.vitest.ts", severity: "critical", issue: "pins wrong output" };

    mocks.runReview.mockResolvedValue(0);
    mocks.readReviewArtifact.mockReturnValue({
      reviewerName: "claude",
      durationMs: 10,
      findings: [critical],
    });
    mocks.runFixTurn.mockResolvedValue({
      success: true,
      durationMs: 1,
      numTurns: 1,
    });
    mocks.runValidate.mockResolvedValue(0);
    mocks.readSelection.mockReturnValue({
      packageName: "a",
      repoRelativeFilePath: "packages/a/src/a.ts",
    });
    mocks.downgradeTargetsByFindings.mockReturnValue({
      downgraded: 1,
      remaining: 0,
      remainingCreated: 0,
      droppedFiles: ["a.vitest.ts"],
      partiallyDowngradedFiles: [],
      droppedByFile: [{ testRepoRel: "a.vitest.ts", findings: [critical] }],
      revertedSourceEdits: [],
    });
    mocks.writeDropMarker.mockReturnValue({ repoRelativePath: "drop-marker.md" });

    const result = await runReviewAndFixStage(config);

    expect(result).toEqual({ success: true, droppedAll: true });
    // Only the post-fix-turn validate fires; no post-downgrade re-run.
    expect(mocks.runValidate).toHaveBeenCalledTimes(1);
    expect(mocks.writeDropMarker).toHaveBeenCalledTimes(1);
  });

  test("aborts when post-downgrade re-validate fails", async () => {
    const config = makeConfig();
    const critical = { file: "a.vitest.ts", severity: "critical", issue: "pins wrong output" };

    mocks.runReview.mockResolvedValue(0);
    mocks.readReviewArtifact.mockReturnValue({
      reviewerName: "claude",
      durationMs: 10,
      findings: [critical],
    });
    mocks.runFixTurn.mockResolvedValue({
      success: true,
      durationMs: 1,
      numTurns: 1,
    });
    // First validate (after fix-turn) passes; second (after downgrade) fails.
    mocks.runValidate.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    mocks.downgradeTargetsByFindings.mockReturnValue({
      downgraded: 1,
      remaining: 1,
      remainingCreated: 1,
      droppedFiles: [],
      partiallyDowngradedFiles: ["a.vitest.ts"],
      droppedByFile: [{ testRepoRel: "a.vitest.ts", findings: [critical] }],
      revertedSourceEdits: [],
    });

    const result = await runReviewAndFixStage(config);

    expect(result.success).toBe(false);
    expect(result.droppedAll).toBe(false);
    expect(result.abortMessage).toContain("re-validate after downgrade failed");
    expect(mocks.runValidate).toHaveBeenCalledTimes(2);
  });
});
