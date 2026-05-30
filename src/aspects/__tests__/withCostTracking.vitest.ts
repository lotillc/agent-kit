import { describe, expect, test, vi } from "vitest";

import { createCostBudget } from "../../domain/pipeline/budget.js";
import type { ModelRunner, ModelRunResult } from "../../ports/ModelRunner.js";
import { withCostTracking } from "../withCostTracking.js";

const makeRunner = (results: ModelRunResult[]): ModelRunner => {
  let i = 0;
  const next = () => results[i++] ?? results[results.length - 1]!;
  return {
    name: "fake",
    runReview: async () => next(),
    runGenerate: async () => next(),
  };
};

const ok = (costUsd: number): ModelRunResult => ({
  success: true,
  rawOutput: "",
  costUsd,
  durationMs: 1,
});

describe("withCostTracking", () => {
  test("records costs from successful runs", async () => {
    const budget = createCostBudget({ limitUsd: 10 });
    const wrapped = withCostTracking(makeRunner([ok(1.5)]), { budget });

    await wrapped.runReview("p", "/w");
    expect(budget.spentUsd).toBe(1.5);
    expect(budget.isExceeded()).toBe(false);
  });

  test("short-circuits when budget already exceeded", async () => {
    const budget = createCostBudget({ limitUsd: 1 });
    budget.record(2); // already over
    const inner = makeRunner([ok(5)]);
    const innerReview = vi.spyOn(inner, "runReview");
    const wrapped = withCostTracking(inner, { budget });

    const result = await wrapped.runReview("p", "/w");

    expect(innerReview).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cost budget exceeded/);
  });

  test("fires onBudgetExceeded when a run pushes over the limit", async () => {
    const budget = createCostBudget({ limitUsd: 1 });
    const onExceeded = vi.fn();
    const wrapped = withCostTracking(makeRunner([ok(0.6), ok(0.6)]), {
      budget,
      onBudgetExceeded: onExceeded,
    });

    await wrapped.runReview("p", "/w");
    expect(onExceeded).not.toHaveBeenCalled();
    await wrapped.runGenerate("p", "/w");
    expect(onExceeded).toHaveBeenCalledTimes(1);
    expect(onExceeded).toHaveBeenCalledWith(1.2, 1);
  });

  test("fires onCostRecorded for each run that reported a cost (for cost.recorded events)", async () => {
    const budget = createCostBudget({ limitUsd: 100 });
    const onCostRecorded = vi.fn();
    const wrapped = withCostTracking(makeRunner([ok(0.6), ok(0.4)]), {
      budget,
      onCostRecorded,
    });

    await wrapped.runReview("p", "/w");
    await wrapped.runGenerate("p", "/w");
    expect(onCostRecorded).toHaveBeenCalledTimes(2);
    expect(onCostRecorded).toHaveBeenNthCalledWith(1, 0.6);
    expect(onCostRecorded).toHaveBeenNthCalledWith(2, 0.4);
  });

  test("short-circuits runGenerate when budget already exceeded", async () => {
    const budget = createCostBudget({ limitUsd: 1 });
    budget.record(2);
    const inner = makeRunner([ok(5)]);
    const innerGenerate = vi.spyOn(inner, "runGenerate");
    const wrapped = withCostTracking(inner, { budget });

    const result = await wrapped.runGenerate("p", "/w");

    expect(innerGenerate).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cost budget exceeded/);
  });

  test("records when costUsd is 0 (semantically 'no charge'); skips when missing", async () => {
    const budget = createCostBudget({ limitUsd: 10 });
    const wrapped = withCostTracking(
      makeRunner([
        { success: true, rawOutput: "", costUsd: 0, durationMs: 1 },
        { success: true, rawOutput: "", durationMs: 1 },
      ]),
      { budget },
    );
    await wrapped.runReview("p", "/w");
    expect(budget.spentUsd).toBe(0);
    await wrapped.runGenerate("p", "/w");
    expect(budget.spentUsd).toBe(0);
  });

  test("preserves the underlying runner's name", () => {
    const budget = createCostBudget({ limitUsd: 1 });
    const wrapped = withCostTracking(makeRunner([ok(0)]), { budget });
    expect(wrapped.name).toBe("fake");
  });

  test("forwards the AbortSignal to the wrapped runner", async () => {
    const budget = createCostBudget({ limitUsd: 10 });
    const seen: (AbortSignal | undefined)[] = [];
    const inner: ModelRunner = {
      name: "capture",
      runReview: async (_p, _w, signal) => {
        seen.push(signal);
        return ok(0);
      },
      runGenerate: async (_p, _w, signal) => {
        seen.push(signal);
        return ok(0);
      },
    };
    const wrapped = withCostTracking(inner, { budget });
    const controller = new AbortController();
    await wrapped.runReview("p", "/w", controller.signal);
    await wrapped.runGenerate("p", "/w", controller.signal);
    expect(seen).toEqual([controller.signal, controller.signal]);
  });
});
