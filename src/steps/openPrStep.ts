import { type CreatePrResult, createPr } from "../adapters/gh-cli/createPr.js";
import { checkoutOrCreateBranch, commitAll, pushBranch } from "../adapters/git/simpleGitOps.js";

/**
 * Step metadata + pure run function for opening a PR via the `gh` CLI.
 * Consumers bind into composer via the usual `step<Bag>()({config})` recipe
 * (see runClaudeStep.ts).
 *
 * Flow:
 *   1. Create the branch at HEAD (no-op if already exists).
 *   2. Commit any remaining changes.
 *   3. Push to remote.
 *   4. Invoke `gh pr create`.
 *
 * Octokit-backed alternative can be layered by a consumer; agent-kit ships
 * the gh-CLI path as the default.
 */

export const OPEN_PR_STEP_NAME = "openPr" as const;
export const OPEN_PR_STEP_NEEDS = [
  "_toolkit_worktreePath",
  "prBranch",
  "prBaseBranch",
  "prTitle",
  "prBody",
  "commitMessage",
] as const;
export const OPEN_PR_STEP_PROVIDES = ["_toolkit_prUrl", "_toolkit_prNumber"] as const;

export interface OpenPrStepInput {
  _toolkit_worktreePath: string;
  prBranch: string;
  prBaseBranch: string;
  prTitle: string;
  prBody: string;
  commitMessage: string;
  prLabels?: ReadonlyArray<string>;
  prDraft?: boolean;
}

export interface OpenPrStepOutput {
  _toolkit_prUrl: string;
  _toolkit_prNumber: number;
}

export const openPrStepRun = (bag: OpenPrStepInput): OpenPrStepOutput => {
  const cwd = bag._toolkit_worktreePath;
  // Idempotent: if a prior run already created/pushed `prBranch` and crashed
  // before `gh pr create`, this step must be retriable. `checkoutOrCreateBranch`
  // switches to an existing branch instead of erroring out.
  checkoutOrCreateBranch({ cwd }, bag.prBranch);
  commitAll({ cwd }, bag.commitMessage);
  pushBranch({ cwd }, bag.prBranch);

  const result: CreatePrResult = createPr({
    cwd,
    title: bag.prTitle,
    body: bag.prBody,
    baseBranch: bag.prBaseBranch,
    labels: bag.prLabels,
    draft: bag.prDraft,
  });
  if (!result.ok) {
    throw new Error(
      `gh pr create failed: ${result.stderr.trim() || result.stdout.trim() || "unknown"}`,
    );
  }
  if (result.prUrl === null || result.prNumber === null) {
    throw new Error(
      `gh pr create succeeded but returned no parseable URL/number: ${result.stdout.trim()}`,
    );
  }
  return { _toolkit_prUrl: result.prUrl, _toolkit_prNumber: result.prNumber };
};
