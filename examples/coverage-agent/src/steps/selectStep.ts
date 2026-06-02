import { NO_WORK_EXIT_CODE, runSelect } from "../commands/select.js";
import { AbortedError, type CoverageAgentBag, NoWorkError } from "../pipeline/bag.js";
import type { PipelineStep } from "../pipeline/runSteps.js";

export const SELECT_STEP_NAME = "select" as const;

export const selectStep: PipelineStep<CoverageAgentBag> = {
  name: SELECT_STEP_NAME,
  run: (bag) => {
    const exitCode = runSelect(bag.config);
    if (exitCode === NO_WORK_EXIT_CODE) {
      throw new NoWorkError();
    }
    if (exitCode !== 0) {
      throw new AbortedError("baseline", `select failed (exit ${exitCode})`);
    }
    return {};
  },
};
