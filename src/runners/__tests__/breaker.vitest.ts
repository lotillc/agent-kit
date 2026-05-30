import { afterEach, describe, expect, test } from "vitest";

import type { ModelRunner, ModelRunResult } from "../../ports/ModelRunner.js";
import { __resetBreakerRegistryForTesting, withBreaker } from "../breaker.js";

afterEach(() => {
  __resetBreakerRegistryForTesting();
});

const ok = (): ModelRunResult => ({ success: true, rawOutput: "ok", costUsd: 0, durationMs: 1 });

const makeRunner = (fn: () => Promise<ModelRunResult>): ModelRunner => ({
  name: "test",
  runReview: () => fn(),
  runGenerate: () => fn(),
});

describe("withBreaker", () => {
  test("passes calls through when the upstream is healthy", async () => {
    const runner = withBreaker({
      runner: makeRunner(async () => ok()),
      provider: "test-healthy",
    });
    const result = await runner.runGenerate("p", "/w");
    expect(result.success).toBe(true);
  });

  test("opens the circuit after N consecutive failures and short-circuits", async () => {
    let calls = 0;
    const flaky = makeRunner(async () => {
      calls += 1;
      throw new Error(`upstream 503 #${calls}`);
    });
    const runner = withBreaker({
      runner: flaky,
      provider: "test-flapping",
      options: { breakerThreshold: 3, breakerDurationMs: 60_000 },
    });

    for (let i = 0; i < 3; i += 1) {
      await expect(runner.runGenerate("p", "/w")).rejects.toThrow(/upstream 503/);
    }
    const guarded = await runner.runGenerate("p", "/w");
    expect(guarded.success).toBe(false);
    expect(guarded.error).toMatch(/circuit is open/i);
    // Critical assertion: the breaker prevented the 4th underlying call.
    expect(calls).toBe(3);
  });

  test("4xx errors do not trip the breaker", async () => {
    let calls = 0;
    const clientErr = makeRunner(async () => {
      calls += 1;
      const err = Object.assign(new Error("bad request"), { statusCode: 400 });
      throw err;
    });
    const runner = withBreaker({
      runner: clientErr,
      provider: "test-4xx",
      options: { breakerThreshold: 2, breakerDurationMs: 60_000 },
    });

    for (let i = 0; i < 5; i += 1) {
      await expect(runner.runGenerate("p", "/w")).rejects.toThrow(/bad request/);
    }
    // All 5 calls reached the runner — the breaker stayed closed because
    // 4xx is a client error, not a sign the upstream is unhealthy.
    expect(calls).toBe(5);
  });

  test("shares breaker state across runners with the same provider+baseUrl", async () => {
    let calls = 0;
    const flaky = () =>
      makeRunner(async () => {
        calls += 1;
        throw new Error("upstream 503");
      });
    const a = withBreaker({
      runner: flaky(),
      provider: "shared-prov",
      baseUrl: "https://api.example.com",
      options: { breakerThreshold: 2, breakerDurationMs: 60_000 },
    });
    const b = withBreaker({
      runner: flaky(),
      provider: "shared-prov",
      baseUrl: "https://api.example.com",
      options: { breakerThreshold: 2, breakerDurationMs: 60_000 },
    });

    await expect(a.runGenerate("p", "/w")).rejects.toThrow();
    await expect(a.runGenerate("p", "/w")).rejects.toThrow();
    // Breaker is now open. The second runner inherits the same state.
    const guarded = await b.runGenerate("p", "/w");
    expect(guarded.success).toBe(false);
    expect(guarded.error).toMatch(/circuit is open/i);
    expect(calls).toBe(2);
  });

  // Regression for the codex P1: base runners return success:false rather than
  // throwing, so the breaker must inspect failure results, not just exceptions.
  test("opens the circuit after N consecutive failure RESULTS", async () => {
    let calls = 0;
    const failing = makeRunner(async () => {
      calls += 1;
      return { success: false, rawOutput: "", durationMs: 1, error: "upstream 503" };
    });
    const runner = withBreaker({
      runner: failing,
      provider: "test-result-fail",
      options: { breakerThreshold: 3, breakerDurationMs: 60_000 },
    });

    for (let i = 0; i < 3; i += 1) {
      const r = await runner.runGenerate("p", "/w");
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/upstream 503/);
    }
    const guarded = await runner.runGenerate("p", "/w");
    expect(guarded.error).toMatch(/circuit is open/i);
    expect(calls).toBe(3);
  });

  test("4xx failure RESULTS do not trip the breaker", async () => {
    let calls = 0;
    const clientErr = makeRunner(async () => {
      calls += 1;
      return {
        success: false,
        rawOutput: "",
        durationMs: 1,
        error: "bad request",
        errorStatusCode: 400,
      };
    });
    const runner = withBreaker({
      runner: clientErr,
      provider: "test-4xx-result",
      options: { breakerThreshold: 2, breakerDurationMs: 60_000 },
    });

    for (let i = 0; i < 5; i += 1) {
      const r = await runner.runGenerate("p", "/w");
      expect(r.error).toMatch(/bad request/);
    }
    expect(calls).toBe(5);
  });

  test("sums costUsd across retried attempts so a budget counts all spend", async () => {
    let n = 0;
    const runner = makeRunner(async () => {
      n += 1;
      if (n < 3) {
        return {
          success: false,
          rawOutput: "",
          durationMs: 1,
          costUsd: 0.3,
          error: "upstream 503",
        };
      }
      return { success: true, rawOutput: "ok", durationMs: 1, costUsd: 0.5 };
    });
    const guarded = withBreaker({
      runner,
      provider: "test-retry-cost",
      options: { maxRetries: 2, baseDelayMs: 0, breakerThreshold: 5, breakerDurationMs: 60_000 },
    });
    const result = await guarded.runGenerate("p", "/w");
    expect(result.success).toBe(true);
    expect(n).toBe(3); // 1 initial + 2 retries
    expect(result.costUsd).toBeCloseTo(1.1, 6); // 0.3 + 0.3 + 0.5, not just the final 0.5
  });

  test("429 rate-limit RESULTS trip the breaker (transient, unlike other 4xx)", async () => {
    let calls = 0;
    const limited = makeRunner(async () => {
      calls += 1;
      return {
        success: false,
        rawOutput: "",
        durationMs: 1,
        error: "rate limited",
        errorStatusCode: 429,
      };
    });
    const runner = withBreaker({
      runner: limited,
      provider: "test-429",
      options: { breakerThreshold: 3, breakerDurationMs: 60_000 },
    });

    for (let i = 0; i < 3; i += 1) {
      const r = await runner.runGenerate("p", "/w");
      expect(r.error).toMatch(/rate limited/);
    }
    const guarded = await runner.runGenerate("p", "/w");
    expect(guarded.error).toMatch(/circuit is open/i);
    expect(calls).toBe(3);
  });

  test("caller-cancelled failures are neither retried nor counted toward the circuit", async () => {
    let calls = 0;
    const failing = makeRunner(async () => {
      calls += 1;
      return { success: false, rawOutput: "", durationMs: 0, error: "cancelled" };
    });
    const runner = withBreaker({
      runner: failing,
      provider: "test-caller-cancel",
      // maxRetries set: a caller cancellation must NOT be retried even with retries on.
      options: { breakerThreshold: 2, breakerDurationMs: 60_000, maxRetries: 3 },
    });
    const controller = new AbortController();
    controller.abort(); // caller cancels

    for (let i = 0; i < 5; i += 1) {
      const r = await runner.runGenerate("p", "/w", controller.signal);
      expect(r.error).toMatch(/cancelled/);
    }
    // 5 invocations, one underlying call each: no retries, breaker stayed closed.
    expect(calls).toBe(5);
  });

  // claude-cli config: no per-attempt cooperative timeout is applied, and the
  // runner receives the caller's cancellation signal directly.
  test("passCooperativeTimeoutSignal=false forwards caller cancellation to the runner", async () => {
    let receivedAborted: boolean | undefined;
    let calls = 0;
    const runner = withBreaker({
      runner: {
        name: "cli-like",
        runReview: (_p, _w, signal) => {
          calls += 1;
          receivedAborted = signal?.aborted;
          return Promise.resolve({
            success: false,
            rawOutput: "",
            durationMs: 0,
            error: "cancelled",
          });
        },
        runGenerate: () => Promise.resolve(ok()),
      },
      provider: "claude-cli",
      options: { breakerThreshold: 2, breakerDurationMs: 60_000, maxRetries: 3 },
      passCooperativeTimeoutSignal: false,
    });
    const controller = new AbortController();
    controller.abort();
    const result = await runner.runReview("p", "/w", controller.signal);
    // Runner saw the CALLER signal (not a cooperative-timeout signal), and the
    // cancellation was neither retried nor counted toward the circuit.
    expect(receivedAborted).toBe(true);
    expect(result.error).toMatch(/cancelled/);
    expect(calls).toBe(1);
  });

  // The cooperative per-attempt timeout aborts via the cockatiel signal, which
  // the breaker now threads into the runner.
  test("per-attempt timeout aborts a signal-aware runner", async () => {
    const runner: ModelRunner = {
      name: "slow",
      runReview: (_p, _w, signal) =>
        new Promise<ModelRunResult>((resolve) => {
          signal?.addEventListener("abort", () =>
            resolve({ success: false, rawOutput: "", durationMs: 0, error: "aborted by signal" }),
          );
        }),
      runGenerate: () => Promise.resolve(ok()),
    };
    const guarded = withBreaker({
      runner,
      provider: "test-timeout-signal",
      options: { perAttemptTimeoutMs: 20, breakerThreshold: 5, breakerDurationMs: 60_000 },
    });
    const result = await guarded.runReview("p", "/w");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/aborted/i);
  });

  test("different baseUrls have isolated breakers", async () => {
    let urlACalls = 0;
    let urlBCalls = 0;
    const a = withBreaker({
      runner: makeRunner(async () => {
        urlACalls += 1;
        throw new Error("upstream 503 on A");
      }),
      provider: "iso-prov",
      baseUrl: "https://a.example.com",
      options: { breakerThreshold: 2, breakerDurationMs: 60_000 },
    });
    const b = withBreaker({
      runner: makeRunner(async () => {
        urlBCalls += 1;
        return ok();
      }),
      provider: "iso-prov",
      baseUrl: "https://b.example.com",
      options: { breakerThreshold: 2, breakerDurationMs: 60_000 },
    });

    await expect(a.runGenerate("p", "/w")).rejects.toThrow();
    await expect(a.runGenerate("p", "/w")).rejects.toThrow();
    // A's breaker is open; B is unaffected.
    const result = await b.runGenerate("p", "/w");
    expect(result.success).toBe(true);
    expect(urlACalls).toBe(2);
    expect(urlBCalls).toBe(1);
  });
});
