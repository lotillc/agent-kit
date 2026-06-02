import { runStrykerBaseline } from "../commands/strykerBaseline.js";
import type { CoverageAgentBag } from "../pipeline/bag.js";
import type { PipelineStep } from "../pipeline/runSteps.js";

export const STRYKER_BASELINE_STEP_NAME = "stryker-baseline" as const;

/**
 * Soft-fail: missing baseline mutation data skips the later gate instead of
 * aborting the run.
 */
export const strykerBaselineStep: PipelineStep<CoverageAgentBag> = {
  name: STRYKER_BASELINE_STEP_NAME,
  run: (bag) => {
    try {
      runStrykerBaseline(bag.config);
    } catch (err) {
      process.stderr.write(
        `[pipeline:stryker-baseline] ignored error: ${(err as Error).message}\n`,
      );
    }
    return {};
  },
};
