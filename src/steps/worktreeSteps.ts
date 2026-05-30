import {
  createEphemeralWorktree,
  type PreflightStrategy,
  preflightWorktree,
  removeWorktree,
  validateWorkingTreeDiff,
} from "../adapters/git/index.js";
import type { ClassifyChangesResult } from "../domain/diff/index.js";

/**
 * Step metadata + pure run functions for the worktree lifecycle steps. Same
 * pattern as `runClaudeStep` — consumers bind to their own Bag via composer's
 * `step<Bag>()`. See `runClaudeStep.ts` for the full rationale.
 *
 * Bag contract (add these fields to your workflow's Bag type):
 *
 *   - `_toolkit_worktreePath` — set by createWorktreeStep, consumed downstream
 *   - `_toolkit_diffValidation` — set by validateDiffStep
 *   - `_toolkit_preflightOk` — set by preflightStep
 */

// =====================
// createWorktreeStep
// =====================

export const CREATE_WORKTREE_STEP_NAME = "createWorktree" as const;
export const CREATE_WORKTREE_STEP_NEEDS = ["repoRoot", "baseRef"] as const;
export const CREATE_WORKTREE_STEP_PROVIDES = ["_toolkit_worktreePath"] as const;

export interface CreateWorktreeStepInput {
  repoRoot: string;
  baseRef: string;
}

export interface CreateWorktreeStepOutput {
  _toolkit_worktreePath: string;
}

export const createWorktreeStepRun = (bag: CreateWorktreeStepInput): CreateWorktreeStepOutput => {
  const { worktreePath } = createEphemeralWorktree({
    repoRoot: bag.repoRoot,
    baseRef: bag.baseRef,
  });
  return { _toolkit_worktreePath: worktreePath };
};

// =====================
// preflightStep
// =====================

export const PREFLIGHT_STEP_NAME = "preflight" as const;
export const PREFLIGHT_STEP_NEEDS = ["_toolkit_worktreePath", "preflightStrategy"] as const;
export const PREFLIGHT_STEP_PROVIDES = ["_toolkit_preflightOk"] as const;

export interface PreflightStepInput {
  _toolkit_worktreePath: string;
  preflightStrategy: PreflightStrategy;
  preflightScriptPath?: string;
}

export interface PreflightStepOutput {
  _toolkit_preflightOk: boolean;
}

export const preflightStepRun = (bag: PreflightStepInput): PreflightStepOutput => {
  const result = preflightWorktree({
    worktreePath: bag._toolkit_worktreePath,
    strategy: bag.preflightStrategy,
    scriptPath: bag.preflightScriptPath,
  });
  if (!result.ok) {
    throw new Error(`preflight failed (${result.strategy}): ${result.error ?? "unknown"}`);
  }
  return { _toolkit_preflightOk: true };
};

// =====================
// validateDiffStep
// =====================

export const VALIDATE_DIFF_STEP_NAME = "validateDiff" as const;
export const VALIDATE_DIFF_STEP_NEEDS = [
  "_toolkit_worktreePath",
  "baseRef",
  "testFilePatterns",
  "sourcePathPattern",
] as const;
export const VALIDATE_DIFF_STEP_PROVIDES = ["_toolkit_diffValidation"] as const;

/**
 * Note: `testFilePatterns` and `sourcePathPattern` carry `RegExp` values which
 * do NOT survive `JSON.stringify` (they serialize to `{}`). Consumers using
 * `makeCheckpoint` to persist the bag mid-run must exclude these fields via
 * the checkpoint's `fields` filter, or reconstruct the patterns at load time.
 */
export interface ValidateDiffStepInput {
  _toolkit_worktreePath: string;
  baseRef: string;
  testFilePatterns: ReadonlyArray<RegExp>;
  sourcePathPattern: RegExp;
}

export interface ValidateDiffStepOutput {
  _toolkit_diffValidation: ClassifyChangesResult;
}

export const validateDiffStepRun = (bag: ValidateDiffStepInput): ValidateDiffStepOutput => {
  const result = validateWorkingTreeDiff({
    cwd: bag._toolkit_worktreePath,
    baseRef: bag.baseRef,
    testFilePatterns: bag.testFilePatterns,
    sourcePathPattern: bag.sourcePathPattern,
  });
  return { _toolkit_diffValidation: result };
};

// =====================
// cleanupWorktreeStep
// =====================

export const CLEANUP_WORKTREE_STEP_NAME = "cleanupWorktree" as const;
export const CLEANUP_WORKTREE_STEP_NEEDS = ["repoRoot", "_toolkit_worktreePath"] as const;
export const CLEANUP_WORKTREE_STEP_PROVIDES = [] as const;

export interface CleanupWorktreeStepInput {
  repoRoot: string;
  _toolkit_worktreePath: string;
  /** When true, keep the worktree on disk (consumer debugging). */
  keepWorktree?: boolean;
}

export const cleanupWorktreeStepRun = (bag: CleanupWorktreeStepInput): Record<string, never> => {
  removeWorktree({
    repoRoot: bag.repoRoot,
    worktreePath: bag._toolkit_worktreePath,
    keep: bag.keepWorktree,
  });
  return {};
};
