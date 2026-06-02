// Coverage-agent pipeline steps. See pipeline/runSteps.ts for the sequencer
// and pipeline/bag.ts for the bag + typed errors.

export {
  BASELINE_STEP_NAME,
  baselineStep,
} from "./baselineStep.js";
export {
  DOCTOR_STEP_NAME,
  doctorStep,
} from "./doctorStep.js";
export {
  DRY_RUN_GATE_STEP_NAME,
  dryRunGateStep,
} from "./dryRunGateStep.js";
export {
  INVOKE_CLAUDE_STEP_NAME,
  invokeClaudeStep,
} from "./invokeClaudeStep.js";
export {
  OPEN_PR_STEP_NAME,
  openPrStep,
} from "./openPrStep.js";
export {
  REVIEW_AND_FIX_STEP_NAME,
  reviewAndFixStep,
  runReviewAndFixStage,
} from "./reviewAndFixStep.js";
export {
  SELECT_STEP_NAME,
  selectStep,
} from "./selectStep.js";
export {
  STRYKER_BASELINE_STEP_NAME,
  strykerBaselineStep,
} from "./strykerBaselineStep.js";
export {
  VALIDATE_STEP_NAME,
  validateStep,
} from "./validateStep.js";
