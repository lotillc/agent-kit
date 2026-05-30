import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ModelRunner } from "../../ports/ModelRunner.js";
import { withTimeout } from "../withTimeout.js";

const slowRunner: ModelRunner = {
  name: "slow",
  runReview: () =>
    new Promise((resolve) =>
      setTimeout(() => resolve({ success: true, rawOutput: "done", durationMs: 200 }), 200),
    ),
  runGenerate: () =>
    new Promise((resolve) =>
      setTimeout(() => resolve({ success: true, rawOutput: "done", durationMs: 200 }), 200),
    ),
};

const fastRunner: ModelRunner = {
  name: "fast",
  runReview: async () => ({ success: true, rawOutput: "done", durationMs: 5 }),
  runGenerate: async () => ({ success: true, rawOutput: "done", durationMs: 5 }),
};

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns a failure when inner runner exceeds the cap", async () => {
    const wrapped = withTimeout(slowRunner, { timeoutMs: 50 });
    const pending = wrapped.runReview("p", "/w");
    await vi.advanceTimersByTimeAsync(60);
    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });

  test("resolves normally when the inner finishes in time", async () => {
    const wrapped = withTimeout(fastRunner, { timeoutMs: 100 });
    const result = await wrapped.runReview("p", "/w");
    expect(result.success).toBe(true);
    expect(result.rawOutput).toBe("done");
  });

  test("honors custom errorMessage", async () => {
    const wrapped = withTimeout(slowRunner, { timeoutMs: 10, errorMessage: "custom" });
    const pending = wrapped.runReview("p", "/w");
    await vi.advanceTimersByTimeAsync(15);
    const result = await pending;
    expect(result.error).toBe("custom");
  });

  test("forwards the AbortSignal to the inner runner", async () => {
    let seen: AbortSignal | undefined;
    const capture: ModelRunner = {
      name: "capture",
      runReview: async (_p, _w, signal) => {
        seen = signal;
        return { success: true, rawOutput: "", durationMs: 1 };
      },
      runGenerate: async () => ({ success: true, rawOutput: "", durationMs: 1 }),
    };
    const controller = new AbortController();
    const result = await withTimeout(capture, { timeoutMs: 100 }).runReview(
      "p",
      "/w",
      controller.signal,
    );
    expect(seen).toBe(controller.signal);
    expect(result.success).toBe(true);
  });
});
