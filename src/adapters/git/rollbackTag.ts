import { defaultSpawn } from "../process/defaultSpawn.js";

import { GitCommandError, type GitOpsOptions, headSha } from "./simpleGitOps.js";

/**
 * Safety tags for iterate/fix loops.
 * Create a tag before mutating; if tests regress, `git reset --hard <tag>` to
 * recover. Tag naming is `workflow/pre-iterate/<runId>/<iteration>`.
 */
export const formatRollbackTag = (runId: string, iteration: number): string =>
  `workflow/pre-iterate/${runId}/${iteration}`;

export interface CreateRollbackTagInput extends GitOpsOptions {
  runId: string;
  iteration: number;
  /**
   * Commit SHA to tag. **Strongly recommended** in concurrent contexts (async
   * orchestrators, Temporal workflows, parallel steps): pass the SHA you
   * captured at the moment you want to roll back to. When omitted, the tag
   * captures whatever HEAD is at the time of this call, which has a TOCTOU
   * window if anything else commits between your decision and this write.
   */
  sha?: string;
  /**
   * Force-overwrite an existing tag with the same name. Required for resumed
   * workflows (crash-restart, retry with same `runId`+`iteration`) — without
   * this, a re-run hits `tag already exists` and throws.
   */
  force?: boolean;
}

export const createRollbackTag = (input: CreateRollbackTagInput): string => {
  const spawn = input.spawn ?? defaultSpawn;
  const tag = formatRollbackTag(input.runId, input.iteration);
  const sha = input.sha ?? headSha(input);
  const args = input.force ? ["tag", "-f", tag, sha] : ["tag", tag, sha];
  const result = spawn("git", args, { cwd: input.cwd });
  if (result.exitCode !== 0) {
    throw new GitCommandError({
      args,
      cwd: input.cwd,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  return tag;
};

export interface RollbackInput extends GitOpsOptions {
  runId: string;
  iteration: number;
}

export const rollbackToTag = (input: RollbackInput): void => {
  const spawn = input.spawn ?? defaultSpawn;
  const tag = formatRollbackTag(input.runId, input.iteration);
  const resetResult = spawn("git", ["reset", "--hard", tag], { cwd: input.cwd });
  if (resetResult.exitCode !== 0) {
    throw new GitCommandError({
      args: ["reset", "--hard", tag],
      cwd: input.cwd,
      exitCode: resetResult.exitCode,
      stdout: resetResult.stdout,
      stderr: resetResult.stderr,
    });
  }
  // `git reset --hard` only restores tracked paths. Iterate/fix loops often
  // leave untracked artifacts (generated tests, build outputs, agent scratch)
  // that a "rolled back" workspace should not retain. `clean -fd` removes
  // untracked files + dirs but preserves `.gitignore`'d paths (e.g.
  // `node_modules`) — that's the desired pre-iterate state. Add `-x` only if
  // the consumer truly wants to nuke everything.
  const cleanResult = spawn("git", ["clean", "-fd"], { cwd: input.cwd });
  if (cleanResult.exitCode !== 0) {
    throw new GitCommandError({
      args: ["clean", "-fd"],
      cwd: input.cwd,
      exitCode: cleanResult.exitCode,
      stdout: cleanResult.stdout,
      stderr: cleanResult.stderr,
    });
  }
};
