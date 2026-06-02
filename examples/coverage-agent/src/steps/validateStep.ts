import { runValidate } from "../commands/validate.js";
import { AbortedError, type CoverageAgentBag } from "../pipeline/bag.js";
import type { PipelineStep } from "../pipeline/runSteps.js";

export const VALIDATE_STEP_NAME = "validate" as const;

export const validateStep: PipelineStep<CoverageAgentBag> = {
  name: VALIDATE_STEP_NAME,
  run: async (bag) => {
    const exitCode = await runValidate(bag.config);
    if (exitCode !== 0) {
      throw new AbortedError("quality", `validate failed (exit ${exitCode})`);
    }
    return {};
  },
};
