import { beforeEach, describe, expect, test, vi } from "vitest";

import { __resetPricingWarnCacheForTesting, priceUsage } from "../pricing.js";

beforeEach(() => {
  __resetPricingWarnCacheForTesting();
});

describe("priceUsage", () => {
  test("prices anthropic Sonnet 4.6 input + output", () => {
    const cost = priceUsage("anthropic", "claude-sonnet-4-6", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(cost).toBeCloseTo(18, 5);
  });

  test("prices anthropic Haiku 4.5 with cache read discount", () => {
    const cost = priceUsage("anthropic", "claude-haiku-4-5", {
      inputTokens: 10_000_000,
      outputTokens: 0,
      cacheReadTokens: 10_000_000,
      cacheCreationTokens: 0,
    });
    // All input was a cache read ($0.10/MTok), so 10M * 0.10 = $1.00.
    expect(cost).toBeCloseTo(1, 5);
  });

  // Regression for the codex P2: AI SDK v6 reports inputTokens as the grand
  // total (incl. cached), so cached tokens must not be charged at both the full
  // input rate and the cache rate.
  test("does not double-charge cached input tokens", () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 800_000,
      cacheCreationTokens: 0,
    };
    // 200k non-cached @ $3 + 800k cache read @ $0.30 = 0.6 + 0.24 = $0.84.
    const cost = priceUsage("anthropic", "claude-sonnet-4-6", usage);
    expect(cost).toBeCloseTo(0.84, 5);
    // Strictly less than charging all 1M input at the full rate ($3).
    const naive = priceUsage("anthropic", "claude-sonnet-4-6", {
      ...usage,
      cacheReadTokens: 0,
    });
    expect(cost).toBeLessThan(naive);
  });

  test("prices current OpenAI and Anthropic flagship models (no $0 miss)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const usage = {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };
      expect(priceUsage("openai", "gpt-5.5", usage)).toBeCloseTo(5, 5);
      expect(priceUsage("openai", "gpt-5.4-nano", usage)).toBeCloseTo(0.2, 5);
      expect(priceUsage("openai", "gpt-5", usage)).toBeCloseTo(1.25, 5);
      expect(priceUsage("openai", "gpt-4.1-nano", usage)).toBeCloseTo(0.1, 5);
      expect(priceUsage("anthropic", "claude-opus-4-8", usage)).toBeCloseTo(5, 5);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("prices openai gpt-4o-mini", () => {
    const cost = priceUsage("openai", "gpt-4o-mini", {
      inputTokens: 2_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(cost).toBeCloseTo(0.9, 5);
  });

  test("claude-cli provider shares anthropic pricing", () => {
    const a = priceUsage("claude-cli", "claude-opus-4-7", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    const b = priceUsage("anthropic", "claude-opus-4-7", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(a).toBe(b);
  });

  test("unknown model returns 0 and warns once per (provider,model)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const usage = {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };
      expect(priceUsage("anthropic", "totally-made-up-model", usage)).toBe(0);
      expect(priceUsage("anthropic", "totally-made-up-model", usage)).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toMatch(/anthropic\/totally-made-up-model/);
      // A different unknown model warns separately.
      expect(priceUsage("anthropic", "another-made-up-model", usage)).toBe(0);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  test("ollama provider returns 0 silently (no pricing table is expected)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const usage = {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };
      expect(priceUsage("ollama", "llama3.2", usage)).toBe(0);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  // Regression guard for the codex P1: ensure the longest matching prefix
  // wins, not the first one in insertion order.
  test("OpenAI date-suffixed mini snapshot resolves to mini rate, not parent rate", () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    const miniSnapshot = priceUsage("openai", "gpt-4o-mini-2024-07-18", usage);
    const miniRate = priceUsage("openai", "gpt-4o-mini", usage);
    const parentRate = priceUsage("openai", "gpt-4o", usage);
    expect(miniSnapshot).toBe(miniRate);
    expect(miniSnapshot).not.toBe(parentRate);
  });

  test("OpenAI gpt-4.1-mini snapshot resolves to mini rate, not parent gpt-4.1", () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    const miniSnapshot = priceUsage("openai", "gpt-4.1-mini-2025-04-14", usage);
    const miniRate = priceUsage("openai", "gpt-4.1-mini", usage);
    const parentRate = priceUsage("openai", "gpt-4.1", usage);
    expect(miniSnapshot).toBe(miniRate);
    expect(miniSnapshot).not.toBe(parentRate);
  });

  test("Anthropic snapshot ID resolves to base model rate", () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    const snapshot = priceUsage("anthropic", "claude-haiku-4-5-20251015", usage);
    const base = priceUsage("anthropic", "claude-haiku-4-5", usage);
    expect(snapshot).toBe(base);
  });
});
