/**
 * Pure branch-name conventions for stacked / follow-up PRs.
 *
 * Agent-kit ships them generic over the prefix so each consumer keeps its
 * own brand (`agent-review/`, `my-coverage/`).
 */

export interface StackedBranchNamingInput {
  /** Brand-prefix for the stacked-PR convention, e.g. `"agent-review"`. */
  prefix: string;
  /** The PR number the stack is attached to. */
  sourcePrNumber: number;
  /** Short disambiguating id — a short run id, timestamp slug, or commit prefix. */
  shortId: string;
}

/**
 * Build a fully-qualified stacked branch name:
 *   `<prefix>/pr-<sourcePr>/<shortId>`
 */
export const buildStackedBranchName = ({
  prefix,
  sourcePrNumber,
  shortId,
}: StackedBranchNamingInput): string => `${prefix}/pr-${sourcePrNumber}/${shortId}`;

/**
 * Return the prefix for a stacked branch belonging to a source PR:
 *   `<prefix>/pr-<sourcePr>/`
 *
 * Useful for filtering `git branch -r` or `gh pr list` results.
 */
export const stackedBranchPrefix = (prefix: string, sourcePrNumber: number): string =>
  `${prefix}/pr-${sourcePrNumber}/`;

/**
 * Extract the source PR number from a stacked branch name, or `null` if the
 * name doesn't match the expected shape.
 *
 * Uses string operations + a single static regex (`/^\d+$/`) on the number
 * segment rather than `new RegExp(`...${prefix}...`)`. Even when the prefix is
 * escaped, SAST tools (WS-I011-JAVASCRIPT-00003 et al.) flag dynamic regex
 * construction — and there's no behavioral reason to use a regex here.
 */
export const parseSourcePrFromBranch = (prefix: string, branchName: string): number | null => {
  const expected = `${prefix}/pr-`;
  if (!branchName.startsWith(expected)) return null;
  const rest = branchName.slice(expected.length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx === -1) return null;
  const numStr = rest.slice(0, slashIdx);
  if (numStr.length === 0 || !/^\d+$/.test(numStr)) return null;
  const n = Number.parseInt(numStr, 10);
  return Number.isFinite(n) ? n : null;
};
