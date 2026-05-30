/**
 * Run a sub-workflow while a predicate holds, up to `maxIterations` times.
 * Models an iterate-phase pattern: review → fix →
 * re-review until blocking findings resolve or the budget runs out.
 *
 * Pure — no I/O, no composer dependency. Each iteration calls the supplied
 * `runIteration` function, which returns the next state. `shouldContinue`
 * inspects the state and decides whether to loop again.
 *
 * Consumers writing a composer workflow wrap a sub-workflow in this helper:
 * ```ts
 * const result = await boundedLoop({
 *   initial: { iteration: 0, review },
 *   maxIterations: 3,
 *   shouldContinue: (s) => s.review.findings.some((f) => f.severity === "critical"),
 *   runIteration: async (s) => {
 *     await runFixWorkflow(s);
 *     const review = await runReviewWorkflow();
 *     return { iteration: s.iteration + 1, review };
 *   },
 * });
 * ```
 */
export interface BoundedLoopInput<State> {
  initial: State;
  maxIterations: number;
  shouldContinue: (state: State) => boolean;
  runIteration: (state: State) => Promise<State>;
  /** Called after each iteration; useful for Slack / structured logs. */
  onIteration?: (iteration: number, state: State) => void;
}

export interface BoundedLoopResult<State> {
  finalState: State;
  iterationsRun: number;
  reachedMaxIterations: boolean;
}

export const boundedLoop = async <State>({
  initial,
  maxIterations,
  shouldContinue,
  runIteration,
  onIteration,
}: BoundedLoopInput<State>): Promise<BoundedLoopResult<State>> => {
  if (!Number.isInteger(maxIterations) || maxIterations < 0) {
    // Reject non-integer values (1.5 would run 2 iterations and then report
    // `reachedMaxIterations: false` because 2 !== 1.5) and non-finite values
    // (NaN / ±Infinity sneak past `< 0` and produce nonsense control flow).
    // Fail fast — usually means env/config parsing produced garbage.
    throw new TypeError(
      `boundedLoop maxIterations must be a non-negative integer, got ${maxIterations}`,
    );
  }
  let state = initial;
  let i = 0;
  let wouldContinue = shouldContinue(state);
  while (i < maxIterations && wouldContinue) {
    state = await runIteration(state);
    i += 1;
    onIteration?.(i, state);
    wouldContinue = shouldContinue(state);
  }
  // `shouldContinue` is invoked exactly once per state observation (once for
  // the initial state, then once after each iteration). `reachedMaxIterations`
  // is true only when the cap stopped us — not when the predicate did.
  return {
    finalState: state,
    iterationsRun: i,
    reachedMaxIterations: i === maxIterations && wouldContinue,
  };
};
