import { invokeClaudeStage } from "../commands/invokeClaude.js";
import { AbortedError, type CoverageAgentBag } from "../pipeline/bag.js";
import type { PipelineStep } from "../pipeline/runSteps.js";

export const INVOKE_CLAUDE_STEP_NAME = "invoke-claude" as const;

/**
 * Wrap the shared stage and propagate a reloaded worktree config downstream.
 */
export const invokeClaudeStep: PipelineStep<CoverageAgentBag> = {
  name: INVOKE_CLAUDE_STEP_NAME,
  run: async (bag) => {
    const result = await invokeClaudeStage(bag.config);
    if (!result.success) {
      throw new AbortedError("quality", "invoke-claude failed");
    }
    if (result.config.workingTree !== bag.config.workingTree) {
      process.stderr.write(
        `[pipeline:invoke-claude] reloaded config: workingTree now ${result.config.workingTree}\n`,
      );
      return { config: result.config };
    }
    return {};
  },
};
