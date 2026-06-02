import { type OpenPr, resolveStackBase } from "@lotiai/agent-kit/gh-cli";
import type { SpawnFn } from "@lotiai/agent-kit/ports";

/**
 * Resolve the stack base for a run AND materialize its SHA locally so the
 * ephemeral worktree can be forked directly from it.
 *
 * Why this exists: `resolveStackBase` (pure) picks a base BRANCH name
 * (e.g. `origin/coverage-agent/run/...` when stacking). For `git worktree
 * add --detach <ref>` to succeed, that ref has to resolve to a SHA in the
 * local object db — which isn't guaranteed for a coverage-agent PR head
 * branch the local checkout never fetched. So we explicitly fetch the
 * branch + rev-parse it to a SHA before returning.
 *
 * The resolved `baseSha` is the right thing to hand to the worktree step;
 * the new PR branch then contains ONLY the commits the agent itself makes
 * on top of that SHA, not whatever extra commits exist on the feature
 * branch since the prior stacked PR was opened.
 */

export interface StackBaseForRun {
  /** Branch name to use as the PR base (e.g. `main` or a prior PR's head). */
  baseBranch: string;
  /** Fully-qualified remote ref used to resolve the SHA (e.g. `origin/main`). */
  baseRef: string;
  /** SHA the worktree should fork from. Always resolves locally after this call. */
  baseSha: string;
  /** True when stacked on a prior open coverage-agent PR. */
  isStacked: boolean;
}

export interface ResolveStackBaseForRunInput {
  repoRoot: string;
  sandboxBranch: string;
  openPrs: ReadonlyArray<OpenPr>;
  /** Remote name for the baseRef. Default `"origin"`. */
  remote?: string;
  spawn: SpawnFn;
}

export class StackBaseResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StackBaseResolveError";
  }
}

export function resolveStackBaseForRun({
  repoRoot,
  sandboxBranch,
  openPrs,
  remote = "origin",
  spawn,
}: ResolveStackBaseForRunInput): StackBaseForRun {
  const base = resolveStackBase({ sandboxBranch, openPrs, remote });

  // When stacking, the prior PR's head branch may not be in our local
  // object db yet. Fetch it so `origin/<branch>` resolves to a SHA.
  // Non-stacked runs still fetch (cheap, keeps `origin/main` fresh) so the
  // downstream `git rev-parse` can't race against a stale ref.
  const fetchRes = spawn("git", ["fetch", remote, base.baseBranch], { cwd: repoRoot });
  if (fetchRes.exitCode !== 0) {
    throw new StackBaseResolveError(
      `git fetch ${remote} ${base.baseBranch} failed (exit ${fetchRes.exitCode}): ${fetchRes.stderr}`,
    );
  }

  // Resolve to a SHA so the worktree fork point is pinned — if another
  // process advances the remote ref between here and `git worktree add`
  // we still fork from the SHA we recorded in stack-base.json.
  const revRes = spawn("git", ["rev-parse", base.baseRef], { cwd: repoRoot });
  if (revRes.exitCode !== 0 || !revRes.stdout.trim()) {
    throw new StackBaseResolveError(
      `git rev-parse ${base.baseRef} failed (exit ${revRes.exitCode}): ${revRes.stderr || "empty stdout"}`,
    );
  }
  const baseSha = revRes.stdout.trim();

  return {
    baseBranch: base.baseBranch,
    baseRef: base.baseRef,
    baseSha,
    isStacked: base.isStacked,
  };
}
