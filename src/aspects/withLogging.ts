import type { Logger } from "../ports/Logger.js";
import type { ModelRunner, ModelRunResult } from "../ports/ModelRunner.js";

/**
 * AOP aspect: emit structured start/complete/error log entries around each
 * `ModelRunner` call. Level choice matches ADR-0017 — `info` for lifecycle,
 * `error` for failures.
 */
export interface WithLoggingOptions {
  logger: Logger;
  /** Extra attributes to attach to every log entry (e.g. runId, phase). */
  baseAttrs?: Record<string, unknown>;
}

export const withLogging = (
  runner: ModelRunner,
  { logger, baseAttrs }: WithLoggingOptions,
): ModelRunner => {
  const logAround = async (
    kind: "review" | "generate",
    call: () => Promise<ModelRunResult>,
  ): Promise<ModelRunResult> => {
    const started = Date.now();
    logger.info(`runner ${runner.name}: ${kind} started`, {
      ...baseAttrs,
      runner: runner.name,
      kind,
    });
    try {
      const result = await call();
      logger.info(`runner ${runner.name}: ${kind} completed`, {
        ...baseAttrs,
        runner: runner.name,
        kind,
        success: result.success,
        durationMs: Date.now() - started,
        costUsd: result.costUsd,
      });
      return result;
    } catch (err) {
      logger.error(`runner ${runner.name}: ${kind} threw`, {
        ...baseAttrs,
        runner: runner.name,
        kind,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };

  return {
    name: runner.name,
    runReview: (p, w, signal) => logAround("review", () => runner.runReview(p, w, signal)),
    runGenerate: (p, w, signal) => logAround("generate", () => runner.runGenerate(p, w, signal)),
  };
};
