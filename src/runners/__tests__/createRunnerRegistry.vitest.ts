import { describe, expect, test, vi } from "vitest";

import type { ModelRunner } from "../../ports/ModelRunner.js";
import { createRunnerRegistry } from "../createRunnerRegistry.js";
import type { CostEvent, CostListener, RunnerSpec } from "../RunnerSpec.js";

const makeFakeRunner = (name: string, onCost?: CostListener): ModelRunner => ({
  name,
  runReview: async () => {
    onCost?.(fakeEvent(name, "review"));
    return { success: true, rawOutput: "ok", costUsd: 1, durationMs: 1 };
  },
  runGenerate: async () => {
    onCost?.(fakeEvent(name, "generate"));
    return { success: true, rawOutput: "ok", costUsd: 2, durationMs: 1 };
  },
});

const fakeEvent = (name: string, kind: "review" | "generate"): CostEvent => ({
  runnerName: name,
  provider: "anthropic",
  model: "fake",
  kind,
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  tokensSource: "provider",
  costUsd: kind === "review" ? 1 : 2,
  durationMs: 1,
  at: 0,
  success: true,
});

const fakeFactory = (name: string, _spec: RunnerSpec, opts: { onCost?: CostListener }) =>
  makeFakeRunner(name, opts.onCost);

describe("createRunnerRegistry", () => {
  test("get returns a runner for every registered name", () => {
    const registry = createRunnerRegistry(
      {
        reader: { provider: "anthropic", model: "claude-haiku-4-5", apiKey: "k" },
        writer: { provider: "anthropic", model: "claude-opus-4-7", apiKey: "k" },
      },
      { createRunner: fakeFactory },
    );
    expect(registry.names()).toEqual(["reader", "writer"]);
    expect(registry.get("reader").name).toBe("reader");
    expect(registry.get("writer").name).toBe("writer");
  });

  test("get throws with helpful message for unknown name", () => {
    const registry = createRunnerRegistry(
      { reader: { provider: "anthropic", model: "claude-haiku-4-5" } },
      { createRunner: fakeFactory },
    );
    expect(() => registry.get("nope")).toThrow(/Unknown runner "nope".*reader/);
  });

  test("onCost fans out events from every runner to every subscriber", async () => {
    const registry = createRunnerRegistry(
      {
        reader: { provider: "anthropic", model: "m1" },
        writer: { provider: "anthropic", model: "m2" },
      },
      { createRunner: fakeFactory },
    );
    const a = vi.fn<(event: CostEvent) => void>();
    const b = vi.fn<(event: CostEvent) => void>();
    registry.onCost(a);
    registry.onCost(b);

    await registry.get("reader").runReview("p", "/w");
    await registry.get("writer").runGenerate("p", "/w");

    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
    expect(a.mock.calls[0]![0].runnerName).toBe("reader");
    expect(a.mock.calls[0]![0].kind).toBe("review");
    expect(a.mock.calls[1]![0].runnerName).toBe("writer");
    expect(a.mock.calls[1]![0].kind).toBe("generate");
  });

  test("unsubscribe stops further events reaching the listener", async () => {
    const registry = createRunnerRegistry(
      { reader: { provider: "anthropic", model: "m1" } },
      { createRunner: fakeFactory },
    );
    const listener = vi.fn<(event: CostEvent) => void>();
    const unsub = registry.onCost(listener);
    await registry.get("reader").runReview("p", "/w");
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    await registry.get("reader").runReview("p", "/w");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // Codex P1 regression: a throwing onCost subscriber must not bubble out of
  // broadcast into the runner, nor prevent later subscribers from receiving
  // the event.
  test("throwing listener does not break the runner or starve later listeners", async () => {
    const noisyConsole = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const registry = createRunnerRegistry(
        { reader: { provider: "anthropic", model: "m1" } },
        { createRunner: fakeFactory },
      );
      const thrower = vi.fn<(event: CostEvent) => void>(() => {
        throw new Error("listener boom");
      });
      const survivor = vi.fn<(event: CostEvent) => void>();
      registry.onCost(thrower);
      registry.onCost(survivor);

      const result = await registry.get("reader").runReview("p", "/w");

      expect(result.success).toBe(true);
      expect(thrower).toHaveBeenCalledTimes(1);
      expect(survivor).toHaveBeenCalledTimes(1);
      expect(noisyConsole).toHaveBeenCalled();
    } finally {
      noisyConsole.mockRestore();
    }
  });

  test("listener failures are routed through the configured logger when present", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const registry = createRunnerRegistry(
      { reader: { provider: "anthropic", model: "m1" } },
      { createRunner: fakeFactory, logger },
    );
    registry.onCost(() => {
      throw new Error("boom");
    });

    await registry.get("reader").runReview("p", "/w");

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [event, attrs] = logger.error.mock.calls[0]!;
    expect(event).toBe("runner.cost_listener_threw");
    expect(attrs).toMatchObject({ runnerName: "reader", error: "boom" });
  });

  // Snapshot contract: a listener that subscribes another listener mid-dispatch
  // must not have its newcomer receive the current event. (Pre-snapshot, this
  // depended on JS Set iteration order — a footgun, not a contract.)
  test("listeners added during dispatch do not receive the current event", async () => {
    const registry = createRunnerRegistry(
      { reader: { provider: "anthropic", model: "m1" } },
      { createRunner: fakeFactory },
    );
    const newcomer = vi.fn<(event: CostEvent) => void>();
    const subscriber = vi.fn<(event: CostEvent) => void>(() => {
      registry.onCost(newcomer);
    });
    registry.onCost(subscriber);

    await registry.get("reader").runReview("p", "/w");

    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(newcomer).toHaveBeenCalledTimes(0);

    // Newcomer is wired up for subsequent events.
    await registry.get("reader").runReview("p", "/w");
    expect(newcomer).toHaveBeenCalledTimes(1);
  });
});
