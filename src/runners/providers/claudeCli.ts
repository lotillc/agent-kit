import { ClaudeRunner } from "../../adapters/agent-cli/claude/ClaudeRunner.js";
import type { Logger } from "../../ports/Logger.js";
import type { ModelRunner, ModelRunResult, RunCostContext } from "../../ports/ModelRunner.js";
import { safeCallCostListener } from "../costListener.js";
import type { CostListener, RunnerSpec } from "../RunnerSpec.js";
import { revealSecret } from "../secret.js";

export const createClaudeCliRunner = (
  name: string,
  spec: RunnerSpec,
  onCost?: CostListener,
  logger?: Logger,
): ModelRunner => {
  const inner = new ClaudeRunner({
    name,
    model: spec.model,
    // Mirror the AI SDK runner: fall back to the env var so CI/non-interactive
    // runs use api-key auth instead of runClaudeCode's OAuth default.
    anthropicApiKey: revealSecret(spec.apiKey) ?? process.env.ANTHROPIC_API_KEY,
    timeoutMs: spec.timeoutMs,
  });
  if (!onCost && !logger) return inner;

  const emit = (
    kind: "review" | "generate",
    startedAt: number,
    result: ModelRunResult,
    context?: RunCostContext,
  ): void => {
    safeCallCostListener(
      onCost,
      {
        runnerName: name,
        provider: "claude-cli",
        model: spec.model,
        kind,
        inputTokens: result.tokens?.inputTokens ?? 0,
        outputTokens: result.tokens?.outputTokens ?? 0,
        cacheReadTokens: result.tokens?.cacheReadTokens ?? 0,
        cacheCreationTokens: result.tokens?.cacheCreationTokens ?? 0,
        tokensSource: "cli",
        costUsd: result.costUsd ?? 0,
        durationMs: result.durationMs,
        at: startedAt,
        success: result.success,
        correlationId: context?.correlationId,
        tags: context?.tags,
      },
      logger,
    );
    if (logger) {
      const event = result.success ? "runner.invoke.success" : "runner.invoke.failure";
      const log = result.success ? logger.info : logger.error;
      log.call(logger, event, {
        runner: name,
        provider: "claude-cli",
        model: spec.model,
        kind,
        durationMs: result.durationMs,
        costUsd: result.costUsd,
      });
    }
  };

  // startedAt captured before the inner call so CostEvent.at = call-start time.
  // The `signal` here is caller cancellation only (createRunner withholds the
  // breaker's cooperative-timeout signal from claude-cli so long agentic runs
  // aren't killed by the per-attempt default); ClaudeRunner kills the tree on it.
  return {
    name,
    runReview: async (prompt, workingDir, signal, context) => {
      const startedAt = Date.now();
      const result = await inner.runReview(prompt, workingDir, signal);
      emit("review", startedAt, result, context);
      return result;
    },
    runGenerate: async (prompt, workingDir, signal, context) => {
      const startedAt = Date.now();
      const result = await inner.runGenerate(prompt, workingDir, signal);
      emit("generate", startedAt, result, context);
      return result;
    },
  };
};
