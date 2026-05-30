import { describe, expect, test } from "vitest";

import { extractStats } from "../extractStats.js";
import type { StreamEvent } from "../streamEvents.js";

describe("extractStats", () => {
  test("falls back to wall-clock duration when event omits duration_ms", () => {
    const event: StreamEvent = { type: "result" };
    const stats = extractStats(event, 9999);
    expect(stats.durationMs).toBe(9999);
  });

  test("prefers event duration_ms over wall-clock", () => {
    const event: StreamEvent = { type: "result", duration_ms: 5000 };
    const stats = extractStats(event, 9999);
    expect(stats.durationMs).toBe(5000);
  });

  test("surfaces apiDurationMs, totalCostUsd, numTurns", () => {
    const event: StreamEvent = {
      type: "result",
      duration_ms: 5000,
      duration_api_ms: 3500,
      total_cost_usd: 0.1234,
      num_turns: 7,
    };
    const stats = extractStats(event, 0);
    expect(stats.apiDurationMs).toBe(3500);
    expect(stats.totalCostUsd).toBe(0.1234);
    expect(stats.numTurns).toBe(7);
  });

  test("aggregates token counts across multiple models", () => {
    const event: StreamEvent = {
      type: "result",
      modelUsage: {
        "claude-opus-4-6": {
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadInputTokens: 300,
          cacheCreationInputTokens: 100,
        },
        "claude-sonnet-4-6": {
          inputTokens: 2000,
          outputTokens: 400,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      },
    };
    const stats = extractStats(event, 0);
    expect(stats.inputTokens).toBe(3000);
    expect(stats.outputTokens).toBe(600);
    expect(stats.cacheReadTokens).toBe(300);
    expect(stats.cacheCreationTokens).toBe(100);
  });

  test("preserves per-model breakdown (ADR-0019)", () => {
    const event: StreamEvent = {
      type: "result",
      modelUsage: {
        "claude-opus-4-6": { inputTokens: 1000, outputTokens: 200 },
        "claude-sonnet-4-6": { inputTokens: 2000, outputTokens: 400 },
      },
    };
    const stats = extractStats(event, 0);
    expect(stats.perModel).toHaveLength(2);
    const opus = stats.perModel!.find((p) => p.model === "claude-opus-4-6");
    expect(opus?.inputTokens).toBe(1000);
    expect(opus?.outputTokens).toBe(200);
  });

  test("leaves token fields undefined when modelUsage absent", () => {
    const event: StreamEvent = { type: "result", duration_ms: 100 };
    const stats = extractStats(event, 0);
    expect(stats.inputTokens).toBeUndefined();
    expect(stats.outputTokens).toBeUndefined();
    expect(stats.perModel).toBeUndefined();
  });

  test("handles missing individual model usage fields gracefully", () => {
    const event: StreamEvent = {
      type: "result",
      modelUsage: {
        "claude-sonnet-4-6": {},
      },
    };
    const stats = extractStats(event, 0);
    expect(stats.inputTokens).toBe(0);
    expect(stats.outputTokens).toBe(0);
  });
});
