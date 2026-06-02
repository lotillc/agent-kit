import { openPrStage } from "../commands/openPr.js";
import { AbortedError, type CoverageAgentBag } from "../pipeline/bag.js";
import type { PipelineStep } from "../pipeline/runSteps.js";

export const OPEN_PR_STEP_NAME = "open-pr" as const;

export const openPrStep: PipelineStep<CoverageAgentBag> = {
  name: OPEN_PR_STEP_NAME,
  run: (bag) => {
    const result = openPrStage(bag.config.metricsPath, bag.config);
    if (!result.success) {
      throw new AbortedError("quality", "open-pr failed");
    }
    return { prUrl: result.prUrl ?? null };
  },
};
