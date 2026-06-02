import type { ModelRunner, ModelRunResult } from "../ports/ModelRunner.js";

/**
 * AOP aspect: retry a `ModelRunner` call up to N times on failure (ADR-0042).
 *
 * The retry counts against `success === false` results. Exceptions thrown by
 * the inner runner propagate untouched — use `withLogging` or consumer-side
 * try/catch for those.
 */
export interface WithRetryOptions {
  /** Max attempts; default 3 (ADR-0042). */
  maxAttempts?: number;
  /** Delay between attempts in ms. Default 0 (no backoff). */
  backoffMs?: number;
  /** Called on each retry (attempt number is 1-indexed). */
  onRetry?: (attempt: number, lastResult: ModelRunResult) => void;
  /** Predicate: retry only when this returns true. Default: retry any failure. */
  shouldRetry?: (result: ModelRunResult) => boolean;
}

const wait = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

export const withRetry = (runner: ModelRunner, options: WithRetryOptions = {}): ModelRunner => {
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? 0;
  const shouldRetry = options.shouldRetry ?? ((r) => !r.success);

  const run = async (
    call: () => Promise<ModelRunResult>,
    signal: AbortSignal | undefined,
  ): Promise<ModelRunResult> => {
    let last: ModelRunResult = { success: false, rawOutput: "", durationMs: 0, error: "never ran" };
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      last = await call();
      if (!shouldRetry(last)) return last;
      // Don't keep retrying a call the caller has cancelled — checked both here
      // and after the backoff, since the signal can abort during the wait.
      if (signal?.aborted) return last;
      if (attempt < maxAttempts) {
        options.onRetry?.(attempt, last);
        await wait(backoffMs);
        if (signal?.aborted) return last;
      }
    }
    return last;
  };

  return {
    name: runner.name,
    runReview: (prompt, workingDir, signal, context) =>
      run(() => runner.runReview(prompt, workingDir, signal, context), signal),
    runGenerate: (prompt, workingDir, signal, context) =>
      run(() => runner.runGenerate(prompt, workingDir, signal, context), signal),
  };
};
