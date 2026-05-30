import { describe, expect, test } from "vitest";

import type { Logger } from "../../ports/Logger.js";
import type { ModelRunner } from "../../ports/ModelRunner.js";
import { withLogging } from "../withLogging.js";

const okRunner: ModelRunner = {
  name: "n",
  runReview: async () => ({ success: true, rawOutput: "x", durationMs: 1, costUsd: 0.01 }),
  runGenerate: async () => ({ success: true, rawOutput: "x", durationMs: 1 }),
};

const throwingRunner: ModelRunner = {
  name: "boom",
  runReview: async () => {
    throw new Error("kaboom");
  },
  runGenerate: async () => {
    throw new Error("kaboom");
  },
};

const fakeLogger = (): Logger & {
  calls: Array<{ level: string; message: string; attrs?: Record<string, unknown> }>;
} => {
  const calls: Array<{ level: string; message: string; attrs?: Record<string, unknown> }> = [];
  return {
    calls,
    info: (m, a) => calls.push({ level: "info", message: m, attrs: a }),
    warn: (m, a) => calls.push({ level: "warn", message: m, attrs: a }),
    error: (m, a) => calls.push({ level: "error", message: m, attrs: a }),
    debug: (m, a) => calls.push({ level: "debug", message: m, attrs: a }),
  };
};

describe("withLogging", () => {
  test("emits started + completed info entries around a successful call", async () => {
    const logger = fakeLogger();
    const wrapped = withLogging(okRunner, { logger });
    await wrapped.runReview("p", "/w");
    expect(logger.calls.map((c) => c.level)).toEqual(["info", "info"]);
    expect(logger.calls[0]!.message).toContain("review started");
    expect(logger.calls[1]!.message).toContain("review completed");
    expect(logger.calls[1]!.attrs).toMatchObject({ success: true, costUsd: 0.01 });
  });

  test("baseAttrs are merged into every entry", async () => {
    const logger = fakeLogger();
    const wrapped = withLogging(okRunner, { logger, baseAttrs: { runId: "r1" } });
    await wrapped.runGenerate("p", "/w");
    expect(logger.calls.every((c) => c.attrs?.runId === "r1")).toBe(true);
  });

  test("re-throws after logging when the underlying runner throws", async () => {
    const logger = fakeLogger();
    const wrapped = withLogging(throwingRunner, { logger });
    await expect(wrapped.runReview("p", "/w")).rejects.toThrow("kaboom");
    const errorEntry = logger.calls.find((c) => c.level === "error");
    expect(errorEntry?.message).toContain("review threw");
    expect(errorEntry?.attrs?.error).toBe("kaboom");
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
    await withLogging(capture, { logger: fakeLogger() }).runReview("p", "/w", controller.signal);
    expect(seen).toBe(controller.signal);
  });
});
