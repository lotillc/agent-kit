import { type CoverageAgentBag, DryRunError } from "../pipeline/bag.js";
import type { PipelineStep } from "../pipeline/runSteps.js";

export const DRY_RUN_GATE_STEP_NAME = "dry-run-gate" as const;

export const dryRunGateStep: PipelineStep<CoverageAgentBag> = {
  name: DRY_RUN_GATE_STEP_NAME,
  run: (bag) => {
    if (bag.config.dryRun) {
      process.stderr.write("[pipeline:dry-run] short-circuiting (COVERAGE_AGENT_DRY_RUN=true)\n");
      throw new DryRunError();
    }
    return {};
  },
};
