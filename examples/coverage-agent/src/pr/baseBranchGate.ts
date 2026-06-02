/**
 * Prefix used by coverage-agent's own head branches. When the stack logic
 * picks a prior agent PR as the base, the name starts with this prefix; we
 * allow it implicitly so callers don't have to list every head branch in
 * `allowedBaseBranches`.
 */
export const STACK_BRANCH_PREFIX = "coverage-agent/run/";

export interface AssertBaseBranchAllowedInput {
  baseBranch: string;
  allowedBaseBranches: readonly string[];
}

/**
 * Returns a human-readable error message when the base branch is not allowed,
 * or `null` when it is. Stack bases under `coverage-agent/run/*` are implicitly
 * allowed — that's how stacking works.
 */
export function validateAllowedBaseBranch({
  baseBranch,
  allowedBaseBranches,
}: AssertBaseBranchAllowedInput): string | null {
  if (baseBranch.startsWith(STACK_BRANCH_PREFIX)) return null;
  if (allowedBaseBranches.includes(baseBranch)) return null;
  return `refusing to open PR against ${baseBranch}; not in allowed base branches [${allowedBaseBranches.join(", ")}] and not a coverage-agent stack base`;
}
