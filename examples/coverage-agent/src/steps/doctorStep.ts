import { runDoctor } from "../commands/doctor.js";
import { AbortedError, type CoverageAgentBag } from "../pipeline/bag.js";
import type { PipelineStep } from "../pipeline/runSteps.js";

export const DOCTOR_STEP_NAME = "doctor" as const;

export const doctorStep: PipelineStep<CoverageAgentBag> = {
  name: DOCTOR_STEP_NAME,
  run: async (bag) => {
    const exitCode = await runDoctor(bag.config);
    if (exitCode !== 0) {
      // Doctor runs after selection, so its failures count as quality-stage.
      throw new AbortedError("quality", `doctor failed (exit ${exitCode})`);
    }
    return {};
  },
};
