import { afterEach, describe, expect, test } from "vitest";

import type { ModelRunner } from "../../ports/ModelRunner.js";
import { __resetBreakerRegistryForTesting, withBreaker } from "../breaker.js";
import { createRunner } from "../createRunner.js";

afterEach(() => {
  __resetBreakerRegistryForTesting();
});

const flakyRunner = (counter: { calls: number }): ModelRunner => ({
  name: "fake",
  runReview: async () => {
    counter.calls += 1;
    throw new Error("upstream 503");
  },
  runGenerate: async () => {
    counter.calls += 1;
    throw new Error("upstream 503");
  },
});

describe("createRunner retry semantics", () => {
  test("maxRetries: 1 is honored (1 retry = 2 total attempts)", async () => {
    const counter = { calls: 0 };
    const runner = withBreaker({
      runner: flakyRunner(counter),
      provider: "create-runner-retry-1",
      options: { maxRetries: 1, breakerThreshold: 999, breakerDurationMs: 60_000 },
    });
    await expect(runner.runGenerate("p", "/w")).rejects.toThrow(/upstream 503/);
    expect(counter.calls).toBe(2);
  });

  test("circuit-open response is not re-attempted by an outer retry", async () => {
    const counter = { calls: 0 };
    const guarded = withBreaker({
      runner: flakyRunner(counter),
      provider: "create-runner-open-circuit",
      options: { maxRetries: 0, breakerThreshold: 1, breakerDurationMs: 60_000 },
    });
    await expect(guarded.runGenerate("p", "/w")).rejects.toThrow();
    const open = await guarded.runGenerate("p", "/w");
    expect(open.success).toBe(false);
    expect(open.error).toMatch(/circuit is open/i);
    expect(counter.calls).toBe(1);
  });

  test("createRunner accepts maxRetries: 1 (no `> 1` guard dropping it)", () => {
    expect(() =>
      createRunner("smoke", {
        provider: "ollama",
        model: "llama3.2",
        maxRetries: 1,
        baseUrl: "http://127.0.0.1:1/never-resolves",
      }),
    ).not.toThrow();
  });
});
