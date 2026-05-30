import { describe, expect, test, vi } from "vitest";

import { boundedLoop } from "../boundedLoop.js";

interface S {
  n: number;
  resolved: boolean;
}

describe("boundedLoop", () => {
  test("runs until shouldContinue returns false", async () => {
    const onIteration = vi.fn();
    const result = await boundedLoop<S>({
      initial: { n: 0, resolved: false },
      maxIterations: 10,
      shouldContinue: (s) => !s.resolved,
      runIteration: async (s) => ({ n: s.n + 1, resolved: s.n + 1 === 3 }),
      onIteration,
    });
    expect(result.iterationsRun).toBe(3);
    expect(result.finalState).toEqual({ n: 3, resolved: true });
    expect(result.reachedMaxIterations).toBe(false);
    expect(onIteration).toHaveBeenCalledTimes(3);
  });

  test("stops at maxIterations even if still should continue", async () => {
    const result = await boundedLoop<S>({
      initial: { n: 0, resolved: false },
      maxIterations: 2,
      shouldContinue: () => true,
      runIteration: async (s) => ({ n: s.n + 1, resolved: false }),
    });
    expect(result.iterationsRun).toBe(2);
    expect(result.reachedMaxIterations).toBe(true);
  });

  test("short-circuits when predicate is false on initial state", async () => {
    const runIteration = vi.fn<(s: S) => Promise<S>>();
    const result = await boundedLoop<S>({
      initial: { n: 0, resolved: true },
      maxIterations: 5,
      shouldContinue: (s) => !s.resolved,
      runIteration,
    });
    expect(result.iterationsRun).toBe(0);
    expect(runIteration).not.toHaveBeenCalled();
  });

  test("rejects negative maxIterations", async () => {
    await expect(
      boundedLoop({
        initial: {},
        maxIterations: -1,
        shouldContinue: () => true,
        runIteration: async () => ({}),
      }),
    ).rejects.toThrow(TypeError);
  });

  test("rejects fractional maxIterations (would overrun budget + lie about reachedMaxIterations)", async () => {
    await expect(
      boundedLoop({
        initial: {},
        maxIterations: 1.5,
        shouldContinue: () => true,
        runIteration: async () => ({}),
      }),
    ).rejects.toThrow(TypeError);
  });

  test("rejects NaN / Infinity maxIterations", async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        boundedLoop({
          initial: {},
          maxIterations: bad,
          shouldContinue: () => true,
          runIteration: async () => ({}),
        }),
      ).rejects.toThrow(TypeError);
    }
  });
});
