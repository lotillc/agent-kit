import { type ClaudeCodeRunnerOptions, runClaudeCode } from "../adapters/agent-cli/claude/index.js";
import type { ClaudeCodeResult, ClaudeRunStats } from "../ports/ClaudeRunResult.js";

/**
 * Bag fields the run-claude step reads and writes. Consumers extend their
 * workflow bag with this slice and bind the step via `step<Bag>()` themselves.
 *
 * Why not pre-bind via a generic factory? `@lotiai/composer`'s `step<Bag>()`
 * applies `AssertSerializable<StrictStepReturn<Bag, …>>` to the return type at
 * definition time. When `Bag` is a generic parameter at the factory level,
 * TypeScript cannot evaluate serializability and the constraint degenerates to
 * an unsatisfiable error type. We therefore ship the primitive as a typed
 * function + step-config data; consumers call `step<TheirBag>()(config)`
 * where `TheirBag` is concrete.
 */
export interface RunClaudeStepBagSlice {
  prompt: string;
  worktreePath: string;
  claudeOptions?: ClaudeCodeRunnerOptions;
  _toolkit_claudeResult?: ClaudeCodeResult;
  _toolkit_claudeStats?: ClaudeRunStats;
}

export interface RunClaudeStepInput {
  prompt: string;
  worktreePath: string;
  claudeOptions?: ClaudeCodeRunnerOptions;
}

export interface RunClaudeStepOutput {
  _toolkit_claudeResult: ClaudeCodeResult;
  _toolkit_claudeStats: ClaudeRunStats | undefined;
}

export const RUN_CLAUDE_STEP_NAME = "runClaude" as const;

/**
 * `claudeOptions` is intentionally absent from NEEDS — it's an optional bag
 * field consumers can provide for per-step config overrides, but composer's
 * `.requires()` should not force every consumer to declare it. The run function
 * reads it defensively via `bag.claudeOptions` (undefined ⇒ runner defaults).
 */
export const RUN_CLAUDE_STEP_NEEDS = ["prompt", "worktreePath"] as const;

export const RUN_CLAUDE_STEP_PROVIDES = ["_toolkit_claudeResult", "_toolkit_claudeStats"] as const;

/**
 * Pure run function for the run-claude step. Call this from a thin composer
 * step wrapper in your consumer package.
 *
 * Example:
 * ```ts
 * import { step } from "@lotiai/composer";
 * import {
 *   RUN_CLAUDE_STEP_NAME,
 *   RUN_CLAUDE_STEP_NEEDS,
 *   RUN_CLAUDE_STEP_PROVIDES,
 *   runClaudeStepRun,
 * } from "@lotiai/agent-kit/steps";
 *
 * type Bag = RunClaudeStepBagSlice & {
 *   // your own fields
 * };
 *
 * export const runClaude = step<Bag>()({
 *   name: RUN_CLAUDE_STEP_NAME,
 *   needs: RUN_CLAUDE_STEP_NEEDS,
 *   provides: RUN_CLAUDE_STEP_PROVIDES,
 *   run: async (_ctx, bag) => runClaudeStepRun(bag),
 * });
 * ```
 */
export const runClaudeStepRun = async (bag: RunClaudeStepInput): Promise<RunClaudeStepOutput> => {
  const result = await runClaudeCode(bag.prompt, bag.worktreePath, bag.claudeOptions);
  return {
    _toolkit_claudeResult: result,
    _toolkit_claudeStats: result.stats,
  };
};
