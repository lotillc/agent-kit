import type { ModelRunner, ModelRunResult } from "../ports/ModelRunner.js";

/**
 * AOP aspect: cap any `ModelRunner` call at `timeoutMs`. On timeout the
 * wrapper resolves with a `success: false` `ModelRunResult` — it does not
 * reject. The underlying call is NOT aborted; consumers that need cancelable
 * work should pass an `AbortSignal` to their inner runner directly.
 *
 * See ADR-0043 for the timeout hierarchy (step ≤ workflow ≤ run).
 */
export interface WithTimeoutOptions {
  timeoutMs: number;
  /** Error label to put in `result.error` on timeout. */
  errorMessage?: string;
}

export const withTimeout = (
  runner: ModelRunner,
  { timeoutMs, errorMessage }: WithTimeoutOptions,
): ModelRunner => {
  const cap = async (inner: Promise<ModelRunResult>): Promise<ModelRunResult> => {
    // Track the timer handle so we can clear it when `inner` wins the race.
    // Without this, every successful call leaves a ref'd timer alive until
    // `timeoutMs` elapses — Node won't exit and batch runs leak timers.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<ModelRunResult>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            success: false,
            rawOutput: "",
            durationMs: timeoutMs,
            error: errorMessage ?? `runner ${runner.name} timed out after ${timeoutMs}ms`,
          }),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([inner, timeoutPromise]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  return {
    name: runner.name,
    runReview: (prompt, workingDir, signal) => cap(runner.runReview(prompt, workingDir, signal)),
    runGenerate: (prompt, workingDir, signal) =>
      cap(runner.runGenerate(prompt, workingDir, signal)),
  };
};
