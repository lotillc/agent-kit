import type { ClaudeRunStats } from "../../../ports/ClaudeRunResult.js";

import type { StreamEvent } from "./streamEvents.js";

/**
 * Sum token counts across all models reported in a stream-json `result` event,
 * preserving a per-model breakdown (ADR-0019).
 *
 * Falls back to wall-clock duration when the event omits `duration_ms`.
 */
export const extractStats = (event: StreamEvent, wallClockMs: number): ClaudeRunStats => {
  const stats: ClaudeRunStats = {
    durationMs: event.duration_ms ?? wallClockMs,
    apiDurationMs: event.duration_api_ms,
    totalCostUsd: event.total_cost_usd,
    numTurns: event.num_turns,
  };

  if (event.modelUsage) {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    const perModel: Array<{
      model: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
    }> = [];

    for (const [model, usage] of Object.entries(event.modelUsage)) {
      const modelIn = usage.inputTokens ?? 0;
      const modelOut = usage.outputTokens ?? 0;
      const modelCacheRead = usage.cacheReadInputTokens ?? 0;
      const modelCacheCreate = usage.cacheCreationInputTokens ?? 0;

      inputTokens += modelIn;
      outputTokens += modelOut;
      cacheReadTokens += modelCacheRead;
      cacheCreationTokens += modelCacheCreate;

      perModel.push({
        model,
        inputTokens: modelIn,
        outputTokens: modelOut,
        cacheReadTokens: modelCacheRead,
        cacheCreationTokens: modelCacheCreate,
      });
    }

    stats.inputTokens = inputTokens;
    stats.outputTokens = outputTokens;
    stats.cacheReadTokens = cacheReadTokens;
    stats.cacheCreationTokens = cacheCreationTokens;
    stats.perModel = perModel;
  }

  return stats;
};
