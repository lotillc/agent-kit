// Linear step sequencer: run each step, merge its partial output into the
// bag, and propagate any thrown error.

import type { CoverageAgentBag } from "./bag.js";

export interface PipelineStep<Bag extends object> {
  readonly name: string;
  run(bag: Bag): Promise<Partial<Bag>> | Partial<Bag>;
}

export interface RunStepsOptions<Bag extends object> {
  /** Optional per-step logger; receives the step name before each run. */
  log?: (stepName: string) => void;
  /**
   * Invoked after each successful merge. Used to retain the latest bag state
   * for error handling. Not called when a step throws.
   */
  onStepComplete?: (bag: Bag) => void;
}

/**
 * Run `steps` in order and merge each returned partial into the bag.
 */
export async function runSteps<Bag extends CoverageAgentBag>(
  steps: ReadonlyArray<PipelineStep<Bag>>,
  initialBag: Bag,
  options: RunStepsOptions<Bag> = {},
): Promise<Bag> {
  let bag = initialBag;
  for (const step of steps) {
    options.log?.(step.name);
    const output = await step.run(bag);
    bag = { ...bag, ...output };
    options.onStepComplete?.(bag);
  }
  return bag;
}
