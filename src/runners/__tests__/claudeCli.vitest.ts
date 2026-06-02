import { describe, expect, test, vi } from "vitest";

import type { CostEvent, RunnerSpec } from "../RunnerSpec.js";

// Stub the underlying CLI runner so no Claude process spawns; the wrapper's
// emit() path (which stamps RunCostContext onto the CostEvent) is what we test.
vi.mock("../../adapters/agent-cli/claude/ClaudeRunner.js", () => {
  class ClaudeRunner {
    public readonly name: string;
    constructor(opts: { name?: string } = {}) {
      this.name = opts.name ?? "claude";
    }
    async runReview() {
      return {
        success: true,
        rawOutput: "ok",
        costUsd: 0.42,
        durationMs: 5,
        tokens: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0 },
      };
    }
    async runGenerate() {
      return { success: false, rawOutput: "", durationMs: 3, error: "boom" };
    }
  }
  return { ClaudeRunner };
});

const { createClaudeCliRunner } = await import("../providers/claudeCli.js");

const spec: RunnerSpec = { provider: "claude-cli", model: "claude-opus-4-7", apiKey: "k" };

describe("createClaudeCliRunner cost correlation", () => {
  test("stamps RunCostContext onto the emitted (success) event", async () => {
    const onCost = vi.fn<(event: CostEvent) => void>();
    const runner = createClaudeCliRunner("c", spec, onCost);
    await runner.runReview("p", "/w", undefined, {
      correlationId: "incident-5",
      tags: { incidentId: "incident-5" },
    });
    expect(onCost).toHaveBeenCalledTimes(1);
    const event = onCost.mock.calls[0]![0];
    expect(event.provider).toBe("claude-cli");
    expect(event.success).toBe(true);
    expect(event.correlationId).toBe("incident-5");
    expect(event.tags).toEqual({ incidentId: "incident-5" });
  });

  test("stamps RunCostContext onto the emitted failure event", async () => {
    const onCost = vi.fn<(event: CostEvent) => void>();
    const runner = createClaudeCliRunner("c", spec, onCost);
    await runner.runGenerate("p", "/w", undefined, { correlationId: "incident-6" });
    const event = onCost.mock.calls[0]![0];
    expect(event.success).toBe(false);
    expect(event.correlationId).toBe("incident-6");
  });

  test("omits correlation fields when no context is passed", async () => {
    const onCost = vi.fn<(event: CostEvent) => void>();
    const runner = createClaudeCliRunner("c", spec, onCost);
    await runner.runReview("p", "/w");
    const event = onCost.mock.calls[0]![0];
    expect(event.correlationId).toBeUndefined();
    expect(event.tags).toBeUndefined();
  });
});
