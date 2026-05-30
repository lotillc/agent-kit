import type { ClaudeRunStats } from "../../../ports/ClaudeRunResult.js";
import type { ModelRunner, ModelRunResult } from "../../../ports/ModelRunner.js";
import { type ClaudeCodeRunnerOptions, runClaudeCode } from "./runClaude.js";

/**
 * Adapter: exposes the Claude Code CLI runner as a `ModelRunner`. Lets
 * Claude participate in `domain/review/consensus.ts` alongside Codex and
 * Gemini runners via `ModelRegistry`.
 *
 * Wraps the toolkit's own `runClaudeCode` underneath.
 */
export interface ClaudeRunnerOptions {
  name?: string;
  model?: string;
  anthropicApiKey?: string;
  timeoutMs?: number;
  maxTurns?: number;
  runnerOptions?: ClaudeCodeRunnerOptions;
}

export class ClaudeRunner implements ModelRunner {
  public readonly name: string;
  private readonly opts: ClaudeRunnerOptions;

  constructor(opts: ClaudeRunnerOptions = {}) {
    this.name = opts.name ?? "claude";
    this.opts = opts;
  }

  async runReview(
    prompt: string,
    workingDir: string,
    signal?: AbortSignal,
  ): Promise<ModelRunResult> {
    return this.runOnce(prompt, workingDir, { streamThinking: true, signal });
  }

  async runGenerate(
    prompt: string,
    workingDir: string,
    signal?: AbortSignal,
  ): Promise<ModelRunResult> {
    return this.runOnce(prompt, workingDir, { streamThinking: true, signal });
  }

  private async runOnce(
    prompt: string,
    workingDir: string,
    overrides: Partial<ClaudeCodeRunnerOptions>,
  ): Promise<ModelRunResult> {
    const result = await runClaudeCode(prompt, workingDir, {
      anthropicApiKey: this.opts.anthropicApiKey,
      timeoutMs: this.opts.timeoutMs,
      maxTurns: this.opts.maxTurns,
      model: this.opts.model,
      ...this.opts.runnerOptions,
      ...overrides,
    });
    // Prefer the parsed result text; fall back to "" rather than `result.stdout`
    // (which under streamThinking=true is the full stream-json event log — noisy
    // and misleading for callers expecting the model's answer).
    return {
      success: result.success,
      rawOutput: result.resultText ?? "",
      costUsd: result.stats?.totalCostUsd,
      durationMs: result.durationMs,
      error:
        result.errorMessage ??
        (result.success ? undefined : result.stderr.trim() || `exit ${result.exitCode}`),
      tokens: tokensFromStats(result.stats),
    };
  }
}

const tokensFromStats = (stats: ClaudeRunStats | undefined): ModelRunResult["tokens"] => {
  if (!stats) return undefined;
  const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens } = stats;
  // Only surface usage when the CLI actually reported token counts.
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheReadTokens === undefined &&
    cacheCreationTokens === undefined
  ) {
    return undefined;
  }
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    cacheReadTokens: cacheReadTokens ?? 0,
    cacheCreationTokens: cacheCreationTokens ?? 0,
  };
};
