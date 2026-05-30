import { describe, expect, test, vi } from "vitest";

import type { ModelRunner, ModelRunResult } from "../../ports/ModelRunner.js";
import { withRetry } from "../withRetry.js";

const ok = (): ModelRunResult => ({ success: true, rawOutput: "ok", durationMs: 1 });
const fail = (error: string): ModelRunResult => ({
  success: false,
  rawOutput: "",
  durationMs: 1,
  error,
});

const makeRunner = (responses: ReadonlyArray<ModelRunResult>): ModelRunner => {
  let i = 0;
  const next = async () => responses[i++] ?? responses.at(-1)!;
  return { name: "fake", runReview: next, runGenerate: next };
};

describe("withRetry", () => {
  test("returns immediately on success", async () => {
    const runner = makeRunner([ok()]);
    const wrapped = withRetry(runner, { maxAttempts: 3 });
    const result = await wrapped.runReview("p", "/w");
    expect(result.success).toBe(true);
  });

  test("retries failures up to maxAttempts", async () => {
    const runner = makeRunner([fail("one"), fail("two"), ok()]);
    const wrapped = withRetry(runner, { maxAttempts: 3 });
    const result = await wrapped.runReview("p", "/w");
    expect(result.success).toBe(true);
  });

  test("returns the last failure after maxAttempts", async () => {
    const runner = makeRunner([fail("one"), fail("two"), fail("three")]);
    const wrapped = withRetry(runner, { maxAttempts: 3 });
    const result = await wrapped.runReview("p", "/w");
    expect(result.success).toBe(false);
    expect(result.error).toBe("three");
  });

  test("invokes onRetry between attempts (not after the final attempt)", async () => {
    const runner = makeRunner([fail("e1"), fail("e2"), ok()]);
    const onRetry = vi.fn();
    const wrapped = withRetry(runner, { maxAttempts: 3, onRetry });
    await wrapped.runReview("p", "/w");
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.objectContaining({ error: "e1" }));
  });

  test("respects shouldRetry predicate", async () => {
    const runner = makeRunner([fail("transient"), fail("hard")]);
    const wrapped = withRetry(runner, {
      maxAttempts: 5,
      shouldRetry: (r) => r.error === "transient",
    });
    const result = await wrapped.runReview("p", "/w");
    expect(result.error).toBe("hard");
  });

  test("forwards the AbortSignal and stops retrying once it is aborted", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const controller = new AbortController();
    let calls = 0;
    const runner: ModelRunner = {
      name: "capture",
      runReview: async (_p, _w, signal) => {
        calls += 1;
        seen.push(signal);
        controller.abort(); // caller cancels after the first attempt
        return fail("boom");
      },
      runGenerate: async () => ok(),
    };
    const wrapped = withRetry(runner, { maxAttempts: 5 });
    const result = await wrapped.runReview("p", "/w", controller.signal);
    expect(seen[0]).toBe(controller.signal); // signal forwarded to the inner runner
    expect(calls).toBe(1); // not retried after the caller aborted
    expect(result.error).toBe("boom");
  });

  test("does not start another attempt when aborted during the backoff wait", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      let calls = 0;
      const runner: ModelRunner = {
        name: "capture",
        runReview: async () => {
          calls += 1;
          return fail("boom");
        },
        runGenerate: async () => ok(),
      };
      const wrapped = withRetry(runner, { maxAttempts: 3, backoffMs: 100 });
      const pending = wrapped.runReview("p", "/w", controller.signal);
      // Let attempt 1 fail and the loop enter the 100ms backoff wait.
      await vi.advanceTimersByTimeAsync(0);
      controller.abort(); // caller cancels mid-backoff
      await vi.advanceTimersByTimeAsync(120);
      const result = await pending;
      expect(calls).toBe(1); // the post-backoff abort check prevented attempt 2
      expect(result.error).toBe("boom");
    } finally {
      vi.useRealTimers();
    }
  });

  test("backoffMs waits between attempts under fake timers", async () => {
    vi.useFakeTimers();
    try {
      const runner = makeRunner([fail("e1"), ok()]);
      const wrapped = withRetry(runner, { maxAttempts: 3, backoffMs: 100 });
      const pending = wrapped.runReview("p", "/w");
      // First attempt resolves synchronously (failure). Advancing past the
      // 100ms backoff window lets the second attempt run.
      await vi.advanceTimersByTimeAsync(120);
      const result = await pending;
      expect(result.success).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
