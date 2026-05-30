export {
  type PreflightInput,
  type PreflightResult,
  type PreflightStrategy,
  preflightWorktree,
} from "./preflight.js";
export {
  type CreateRollbackTagInput,
  createRollbackTag,
  formatRollbackTag,
  type RollbackInput,
  rollbackToTag,
} from "./rollbackTag.js";
export {
  changedFiles,
  checkoutOrCreateBranch,
  commitAll,
  createBranch,
  diff,
  GitCommandError,
  type GitOpsOptions,
  hasUncommittedChanges,
  headSha,
  pushBranch,
  restoreFiles,
  showFileAtRef,
} from "./simpleGitOps.js";
export { type ValidateWorkingTreeDiffInput, validateWorkingTreeDiff } from "./validateDiff.js";
export {
  type CreateWorktreeInput,
  type CreateWorktreeResult,
  createEphemeralWorktree,
  type RemoveWorktreeInput,
  readWorktreeMarker,
  removeWorktree,
  removeWorktreeMarker,
  writeWorktreeMarker,
} from "./worktree.js";
