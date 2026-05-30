import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, test, vi } from "vitest";

import { createAiSdkRunner } from "../providers/aiSdkRunner.js";
import type { CostEvent } from "../RunnerSpec.js";

type MockOpts = ConstructorParameters<typeof MockLanguageModelV3>[0];

const mockModel = (opts: {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}) => {
  const generateResult = {
    content: [{ type: "text", text: opts.text }],
    finishReason: "stop",
    usage: {
      inputTokens: {
        total: opts.inputTokens,
        noCache: opts.inputTokens - (opts.cacheReadTokens ?? 0),
        cacheRead: opts.cacheReadTokens ?? 0,
        cacheWrite: opts.cacheCreationTokens ?? 0,
      },
      outputTokens: {
        total: opts.outputTokens,
        text: opts.outputTokens,
        reasoning: 0,
      },
    },
    warnings: [],
  };
  const args: MockOpts = {
    doGenerate: async () => generateResult as unknown as never,
  };
  return new MockLanguageModelV3(args);
};

describe("createAiSdkRunner", () => {
  test("runReview returns ModelRunResult with text + cost", async () => {
    const runner = createAiSdkRunner({
      name: "test",
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      model: mockModel({ text: "hi there", inputTokens: 1_000_000, outputTokens: 500_000 }),
    });
    const result = await runner.runReview("prompt", "/tmp");
    expect(result.success).toBe(true);
    expect(result.rawOutput).toBe("hi there");
    expect(result.costUsd).toBeCloseTo(3 + 7.5, 5);
  });

  test("emits onCost with token breakdown", async () => {
    const onCost = vi.fn<(event: CostEvent) => void>();
    const runner = createAiSdkRunner({
      name: "reader",
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
      model: mockModel({
        text: "ok",
        inputTokens: 300,
        outputTokens: 50,
        cacheReadTokens: 200,
        cacheCreationTokens: 10,
      }),
      onCost,
    });
    await runner.runGenerate("p", "/tmp");
    expect(onCost).toHaveBeenCalledTimes(1);
    const event = onCost.mock.calls[0]![0];
    expect(event.runnerName).toBe("reader");
    expect(event.provider).toBe("anthropic");
    expect(event.model).toBe("claude-haiku-4-5");
    expect(event.kind).toBe("generate");
    expect(event.tokensSource).toBe("provider");
    expect(event.inputTokens).toBe(300);
    expect(event.outputTokens).toBe(50);
    expect(event.cacheReadTokens).toBe(200);
    expect(event.cacheCreationTokens).toBe(10);
    expect(event.success).toBe(true);
    expect(event.costUsd).toBeGreaterThan(0);
  });

  test("cost event kind reflects runReview vs runGenerate", async () => {
    const onCost = vi.fn<(event: CostEvent) => void>();
    const runner = createAiSdkRunner({
      name: "r",
      provider: "openai",
      modelId: "gpt-4o",
      model: mockModel({ text: "ok", inputTokens: 10, outputTokens: 5 }),
      onCost,
    });
    await runner.runReview("p", "/tmp");
    expect(onCost.mock.calls[0]![0].kind).toBe("review");
  });

  test("aborts the call when timeoutMs elapses", async () => {
    const slowModel = {
      specificationVersion: "v3",
      provider: "test",
      modelId: "slow",
      supportedUrls: {},
      doGenerate: async ({ abortSignal }: { abortSignal?: AbortSignal }) =>
        new Promise((_, reject) => {
          abortSignal?.addEventListener("abort", () => reject(new Error("aborted")));
          setTimeout(() => reject(new Error("timeout-never-fires")), 10_000);
        }),
      doStream: async () => ({}) as never,
    } as unknown as Parameters<typeof createAiSdkRunner>[0]["model"];
    const runner = createAiSdkRunner({
      name: "slow",
      provider: "openai",
      modelId: "slow",
      model: slowModel,
      timeoutMs: 20,
    });
    const result = await runner.runGenerate("p", "/tmp");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/abort/i);
  });

  test("returns failure + emits cost event on model error", async () => {
    const onCost = vi.fn<(event: CostEvent) => void>();
    const errorArgs: MockOpts = {
      doGenerate: async () => {
        throw new Error("boom");
      },
    };
    const errorModel = new MockLanguageModelV3(errorArgs);
    const runner = createAiSdkRunner({
      name: "test",
      provider: "openai",
      modelId: "gpt-4o",
      model: errorModel,
      onCost,
    });
    const result = await runner.runGenerate("p", "/tmp");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/boom/);
    expect(onCost).toHaveBeenCalledTimes(1);
    expect(onCost.mock.calls[0]![0].success).toBe(false);
  });

  test("propagates the provider error status code to the result", async () => {
    const errorArgs: MockOpts = {
      doGenerate: async () => {
        throw Object.assign(new Error("rate limited"), { statusCode: 429 });
      },
    };
    const runner = createAiSdkRunner({
      name: "t",
      provider: "openai",
      modelId: "gpt-4o",
      model: new MockLanguageModelV3(errorArgs),
    });
    const result = await runner.runGenerate("p", "/tmp");
    expect(result.success).toBe(false);
    expect(result.errorStatusCode).toBe(429);
  });

  test("aborts when an external (breaker) signal fires", async () => {
    const slowModel = {
      specificationVersion: "v3",
      provider: "test",
      modelId: "slow",
      supportedUrls: {},
      doGenerate: async ({ abortSignal }: { abortSignal?: AbortSignal }) =>
        new Promise((_, reject) => {
          if (abortSignal?.aborted) return reject(new Error("aborted"));
          abortSignal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      doStream: async () => ({}) as never,
    } as unknown as Parameters<typeof createAiSdkRunner>[0]["model"];
    const runner = createAiSdkRunner({
      name: "s",
      provider: "openai",
      modelId: "slow",
      model: slowModel,
    });
    const controller = new AbortController();
    controller.abort();
    const result = await runner.runReview("p", "/tmp", controller.signal);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/abort/i);
  });

  // Regression: a throwing onCost listener passed directly to createAiSdkRunner
  // (i.e. bypassing the registry's broadcast safety net) used to fall through
  // to the catch block, emit a second failure event, and return success:false
  // even though generateText succeeded.
  test("throwing onCost listener does not corrupt the result", async () => {
    const onCost = vi.fn<(event: CostEvent) => void>(() => {
      throw new Error("listener boom");
    });
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const runner = createAiSdkRunner({
        name: "test",
        provider: "openai",
        modelId: "gpt-4o",
        model: mockModel({ text: "ok", inputTokens: 10, outputTokens: 5 }),
        onCost,
      });
      const result = await runner.runGenerate("p", "/tmp");
      expect(result.success).toBe(true);
      expect(result.rawOutput).toBe("ok");
      // Exactly one emission — no second failure event triggered by the throw.
      expect(onCost).toHaveBeenCalledTimes(1);
    } finally {
      consoleWarn.mockRestore();
    }
  });
});
