// Workflow bag + typed errors for the coverage-agent pipeline.
//
// Each step is a `(bag) => Partial<bag>` function; the sequencer in
// `runSteps.ts` merges each return back into the bag. Failure is signaled
// by throwing one of the typed errors below; the outer shell
// (`commands/pipeline.ts`) catches them and maps each to a `PipelineOutcome`.
//
// We don't pull in a BagSlice from `@lotiai/agent-kit/steps` because the
// toolkit steps we compose (runClaude, createWorktree, etc.) are called
// directly from inside our custom steps — the bag never leaves coverage-agent.

import type { CoverageAgentConfig } from "../config.js";

export type PipelineOutcome =
  | "pr_opened"
  | "pr_opened_dropped"
  | "no_work"
  | "aborted_baseline"
  | "aborted_quality"
  | "dry_run";

// Exit code 78 is the Unix convention for EX_CONFIG — we reuse it to mean
// "select produced no work for this cycle".
export const NO_WORK_EXIT_CODE = 78;

export interface CoverageAgentBag {
  /**
   * Mutable — reloaded after invoke-claude creates an ephemeral worktree so
   * every downstream step sees `workingTree === worktreePath`.
   */
  config: CoverageAgentConfig;
  /** Final PR URL from open-pr, if reached. */
  prUrl?: string | null;
  /**
   * Set by `reviewAndFixStep` when the reviewer dropped every test and the
   * step wrote a drop marker so the PR still has diff content. The pipeline
   * reclassifies the terminal outcome from `pr_opened` → `pr_opened_dropped`.
   */
  droppedAll?: boolean;
}

/**
 * Thrown from selectStep when the coverage landscape has no eligible target
 * (selection returned null → exit 78). Maps to outcome `no_work`.
 */
export class NoWorkError extends Error {
  constructor(message = "no work available this cycle") {
    super(message);
    this.name = "NoWorkError";
  }
}

/**
 * Thrown from dryRunGateStep when COVERAGE_AGENT_DRY_RUN is set. Maps to
 * outcome `dry_run`.
 */
export class DryRunError extends Error {
  constructor(message = "dry run requested") {
    super(message);
    this.name = "DryRunError";
  }
}

/**
 * Thrown by any step that fails. `phase` determines whether failure maps to
 * `aborted_baseline` (baseline / select / doctor) or `aborted_quality`
 * (anything later).
 */
export class AbortedError extends Error {
  readonly phase: "baseline" | "quality";
  constructor(phase: "baseline" | "quality", message: string) {
    super(message);
    this.name = "AbortedError";
    this.phase = phase;
  }
}
