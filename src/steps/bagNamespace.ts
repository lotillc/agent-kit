/**
 * Constant field names for toolkit-provided bag slices.
 *
 * The underscore-prefixed `_toolkit_*` pattern is our ADR-0029 convention — a
 * single reserved namespace for fields written by toolkit steps so consumers
 * can grep / lint against collisions with their own step outputs. Dots (which
 * the plan originally proposed) trip TypeScript's dot-access heuristics and
 * show up as property paths in IntelliSense; underscores are unambiguous.
 */
export const TOOLKIT_BAG_KEYS = {
  claudeResult: "_toolkit_claudeResult",
  claudeStats: "_toolkit_claudeStats",
  worktreePath: "_toolkit_worktreePath",
  preflightOk: "_toolkit_preflightOk",
  diffValidation: "_toolkit_diffValidation",
  prUrl: "_toolkit_prUrl",
  prNumber: "_toolkit_prNumber",
} as const;

export type ToolkitBagKey = (typeof TOOLKIT_BAG_KEYS)[keyof typeof TOOLKIT_BAG_KEYS];
