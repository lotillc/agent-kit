import { describe, expect, test } from "vitest";

import type { ModelRunner, ModelRunResult } from "../../../ports/ModelRunner.js";
import {
  aggregateFindings,
  type ModelReviewOutput,
  multiModelReview,
  parseFindingsFromOutput,
} from "../consensus.js";

const makeRunner = (name: string, output: ModelRunResult): ModelRunner => ({
  name,
  runReview: async () => output,
  runGenerate: async () => output,
});

const finding = (filePath: string, description: string, severity = "high") => ({
  filePath,
  severity: severity as "critical" | "high" | "medium" | "low" | "info",
  description,
  autoFixable: false,
});

describe("parseFindingsFromOutput", () => {
  test("parses a JSON array of findings", () => {
    const raw = JSON.stringify([
      { filePath: "a.ts", line: 10, severity: "high", description: "issue" },
    ]);
    expect(parseFindingsFromOutput(raw)).toHaveLength(1);
  });

  test("parses `{ findings: [...] }` shape", () => {
    const raw = JSON.stringify({ findings: [finding("a.ts", "x")] });
    expect(parseFindingsFromOutput(raw)).toHaveLength(1);
  });

  test("accepts legacy `file` and `issue` field aliases", () => {
    const raw = JSON.stringify([{ file: "x.ts", issue: "y" }]);
    const parsed = parseFindingsFromOutput(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.filePath).toBe("x.ts");
    expect(parsed[0]!.description).toBe("y");
  });

  test("returns [] for empty input", () => {
    expect(parseFindingsFromOutput("")).toEqual([]);
  });

  test("returns [] for non-JSON input", () => {
    expect(parseFindingsFromOutput("not json at all")).toEqual([]);
  });

  test("returns [] for items missing required fields", () => {
    expect(parseFindingsFromOutput(JSON.stringify([{ random: "thing" }]))).toEqual([]);
  });
});

describe("aggregateFindings", () => {
  const goodRun = (model: string, findings: ModelReviewOutput["findings"]): ModelReviewOutput => ({
    model,
    findings,
    success: true,
    durationMs: 1,
  });

  test("unanimous when all models flag the same file+description", () => {
    const out1 = goodRun("a", [finding("src/x.ts", "bug")]);
    const out2 = goodRun("b", [finding("src/x.ts", "bug")]);
    const out3 = goodRun("c", [finding("src/x.ts", "bug")]);
    const art = aggregateFindings("r1", [out1, out2, out3], 3);
    expect(art.findings).toHaveLength(1);
    expect(art.findings[0]!.consensus).toBe("unanimous");
    expect(art.stats.unanimousFindings).toBe(1);
  });

  test("majority when more than half flag", () => {
    const out1 = goodRun("a", [finding("x.ts", "bug")]);
    const out2 = goodRun("b", [finding("x.ts", "bug")]);
    const out3 = goodRun("c", []);
    const art = aggregateFindings("r1", [out1, out2, out3], 3);
    expect(art.findings[0]!.consensus).toBe("majority");
    expect(art.stats.majorityFindings).toBe(1);
  });

  test("single when only one flags", () => {
    const out1 = goodRun("a", [finding("x.ts", "bug")]);
    const out2 = goodRun("b", []);
    const art = aggregateFindings("r1", [out1, out2], 2);
    expect(art.findings[0]!.consensus).toBe("single");
  });

  test("sorts by severity then consensus tier", () => {
    const out1 = goodRun("a", [
      finding("x.ts", "low-issue", "low"),
      finding("x.ts", "crit-issue", "critical"),
    ]);
    const out2 = goodRun("b", [finding("x.ts", "crit-issue", "critical")]);
    const art = aggregateFindings("r1", [out1, out2], 2);
    expect(art.findings[0]!.severity).toBe("critical");
    expect(art.findings[0]!.consensus).toBe("unanimous");
    expect(art.findings[1]!.severity).toBe("low");
  });

  test("distinct findings that share the same 100-char prefix stay separate", () => {
    // Regression: dedupe used to key on `description.slice(0, 100)` which
    // would silently merge templated phrasings like
    //   "The function above has a potential null pointer issue on line A"
    //   "The function above has a potential null pointer issue on line B"
    // into one consensus group. Now we key on the full normalized description.
    const prefix = "The function above has a potential null pointer issue on line ".padEnd(95, " ");
    const out1 = goodRun("a", [
      finding("src/x.ts", `${prefix}123`),
      finding("src/x.ts", `${prefix}456`),
    ]);
    const out2 = goodRun("b", []);
    const art = aggregateFindings("r1", [out1, out2], 2);
    expect(art.findings).toHaveLength(2);
  });

  test("dedupes findings that differ only in whitespace formatting", () => {
    // Normalization collapses internal whitespace so models that wrap text
    // at different widths still produce the same consensus key.
    const out1 = goodRun("a", [finding("src/x.ts", "bug in the\nhandler function")]);
    const out2 = goodRun("b", [finding("src/x.ts", "bug in the   handler  function")]);
    const art = aggregateFindings("r1", [out1, out2], 2);
    expect(art.findings).toHaveLength(1);
    expect(art.findings[0]!.consensus).toBe("unanimous");
  });

  test("excludes findings from failed model runs", () => {
    const out1 = goodRun("a", [finding("x.ts", "bug")]);
    const out2: ModelReviewOutput = {
      model: "b",
      findings: [finding("x.ts", "bug")],
      success: false,
      error: "spawn failed",
    };
    const art = aggregateFindings("r1", [out1, out2], 2);
    expect(art.findings).toHaveLength(1);
    expect(art.findings[0]!.consensus).toBe("single");
  });

  test("aggregates cost and duration across all runs (success or not)", () => {
    const out1 = goodRun("a", []);
    const out1WithCost = { ...out1, costUsd: 0.1, durationMs: 100 };
    const out2: ModelReviewOutput = {
      model: "b",
      findings: [],
      success: false,
      costUsd: 0,
      durationMs: 200,
    };
    const art = aggregateFindings("r1", [out1WithCost, out2], 2);
    expect(art.stats.totalCostUsd).toBeCloseTo(0.1);
    expect(art.stats.totalDurationMs).toBe(300);
  });

  test("merged finding takes the highest severity reported across flagging models", () => {
    // Model A says "low", Model B says "critical" for the same file+description.
    // Merged severity must be "critical" — never demote, never depend on input order.
    const lowFinding = finding("x.ts", "bug", "low");
    const criticalFinding = finding("x.ts", "bug", "critical");
    const orderA = aggregateFindings(
      "r1",
      [goodRun("a", [lowFinding]), goodRun("b", [criticalFinding])],
      2,
    );
    const orderB = aggregateFindings(
      "r2",
      [goodRun("a", [criticalFinding]), goodRun("b", [lowFinding])],
      2,
    );
    expect(orderA.findings[0]!.severity).toBe("critical");
    expect(orderB.findings[0]!.severity).toBe("critical");
    expect(orderA.findings[0]!.consensus).toBe("unanimous");
  });
});

describe("multiModelReview", () => {
  test("returns empty artifact when runners is empty", async () => {
    const art = await multiModelReview({
      runners: [],
      prompt: "p",
      workingDir: "/w",
      runId: "r0",
    });
    expect(art.findings).toEqual([]);
    expect(art.stats.totalFindings).toBe(0);
  });

  test("gathers findings from multiple runners in parallel", async () => {
    const runner1 = makeRunner("a", {
      success: true,
      rawOutput: JSON.stringify([finding("x.ts", "bug")]),
      durationMs: 5,
      costUsd: 0.01,
    });
    const runner2 = makeRunner("b", {
      success: true,
      rawOutput: JSON.stringify([finding("x.ts", "bug")]),
      durationMs: 5,
      costUsd: 0.02,
    });
    const art = await multiModelReview({
      runners: [runner1, runner2],
      prompt: "p",
      workingDir: "/w",
      runId: "r1",
    });
    expect(art.findings).toHaveLength(1);
    expect(art.findings[0]!.consensus).toBe("unanimous");
    expect(art.stats.totalCostUsd).toBeCloseTo(0.03);
  });

  test("captures a runner that throws as a failed model output", async () => {
    const throwing: ModelRunner = {
      name: "bad",
      runReview: async () => {
        throw new Error("boom");
      },
      runGenerate: async () => {
        throw new Error("boom");
      },
    };
    const art = await multiModelReview({
      runners: [throwing],
      prompt: "p",
      workingDir: "/w",
      runId: "r",
    });
    const bad = art.modelOutputs.find((o) => o.model === "bad");
    expect(bad?.success).toBe(false);
    expect(bad?.error).toContain("boom");
  });

  test("aborts a runner that exceeds the timeout via its signal", async () => {
    let aborted = false;
    const slow: ModelRunner = {
      name: "slow",
      runReview: (_p, _w, signal) =>
        new Promise((resolve) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            resolve({ success: false, rawOutput: "", durationMs: 0, error: "aborted" });
          });
        }),
      runGenerate: async () => ({ success: false, rawOutput: "", durationMs: 0 }),
    };
    const art = await multiModelReview({
      runners: [slow],
      prompt: "p",
      workingDir: "/w",
      runId: "r-timeout",
      timeoutMs: 5,
    });
    expect(aborted).toBe(true);
    expect(art.modelOutputs[0]?.success).toBe(false);
  });

  test("preserves runner input order in modelOutputs regardless of finish order", async () => {
    const fast = makeRunner("fast", { success: true, rawOutput: "[]", durationMs: 1 });
    const slow: ModelRunner = {
      name: "slow",
      runReview: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ success: true, rawOutput: "[]", durationMs: 1 }), 10),
        ),
      runGenerate: async () => ({ success: true, rawOutput: "[]", durationMs: 1 }),
    };
    const art = await multiModelReview({
      runners: [slow, fast],
      prompt: "p",
      workingDir: "/w",
      runId: "r-order",
    });
    expect(art.modelOutputs.map((o) => o.model)).toEqual(["slow", "fast"]);
  });

  test("passes costContext to every runner's runReview", async () => {
    const seen: Array<string | undefined> = [];
    const spy = (name: string): ModelRunner => ({
      name,
      runReview: async (_p, _w, _signal, context) => {
        seen.push(context?.correlationId);
        return { success: true, rawOutput: "[]", durationMs: 1 };
      },
      runGenerate: async () => ({ success: true, rawOutput: "[]", durationMs: 1 }),
    });
    await multiModelReview({
      runners: [spy("a"), spy("b")],
      prompt: "p",
      workingDir: "/w",
      runId: "r-ctx",
      costContext: { correlationId: "incident-1" },
    });
    expect(seen).toEqual(["incident-1", "incident-1"]);
  });
});
