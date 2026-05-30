import type { OpenPr } from "./listOpenPrs.js";

/**
 * Pick the base branch for a new stacked PR:
 *   - if any of the open agent PRs chain back to `sandboxBranch` (directly or
 *     transitively via headRefName ↔ baseRefName), stack onto the newest one in
 *     that chain
 *   - otherwise fall back to `sandboxBranch`
 *
 * The chain-walk handles the multi-stack case: if the agent has open PRs on
 * two disjoint sandboxes, we only stack onto the chain that matches the
 * current run's `sandboxBranch`. Sorting by `number` alone (newest-first)
 * would otherwise pick whichever chain has the highest PR number, even when
 * it belongs to a different sandbox.
 */
export interface ResolveStackBaseInput {
  sandboxBranch: string;
  openPrs: ReadonlyArray<OpenPr>;
  /** Remote name for the baseRef. Default `"origin"`. */
  remote?: string;
}

export interface StackBase {
  baseBranch: string;
  baseRef: string;
  isStacked: boolean;
  openPrs: ReadonlyArray<OpenPr>;
}

export const resolveStackBase = ({
  sandboxBranch,
  openPrs,
  remote = "origin",
}: ResolveStackBaseInput): StackBase => {
  const chain = openPrsChainedFrom(sandboxBranch, openPrs);
  if (chain.length === 0) {
    return {
      baseBranch: sandboxBranch,
      baseRef: `${remote}/${sandboxBranch}`,
      isStacked: false,
      openPrs,
    };
  }
  const newest = [...chain].sort((a, b) => b.number - a.number)[0]!;
  return {
    baseBranch: newest.headRefName,
    baseRef: `${remote}/${newest.headRefName}`,
    isStacked: true,
    openPrs,
  };
};

/**
 * Returns the subset of `openPrs` whose `baseRefName` transitively reaches
 * `root` by chaining through other PRs in the set (PR.baseRefName matches some
 * other PR.headRefName). Guards against cycles by tracking visited base names.
 */
const openPrsChainedFrom = (root: string, openPrs: ReadonlyArray<OpenPr>): OpenPr[] => {
  const byHead = new Map<string, OpenPr>();
  for (const pr of openPrs) byHead.set(pr.headRefName, pr);

  const result: OpenPr[] = [];
  for (const pr of openPrs) {
    const visited = new Set<string>();
    let cursor: string | undefined = pr.baseRefName;
    while (cursor !== undefined && !visited.has(cursor)) {
      if (cursor === root) {
        result.push(pr);
        break;
      }
      visited.add(cursor);
      cursor = byHead.get(cursor)?.baseRefName;
    }
  }
  return result;
};
