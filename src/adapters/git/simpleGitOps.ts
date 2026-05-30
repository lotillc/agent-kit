import type { SpawnFn } from "../../ports/SpawnFn.js";
import { defaultSpawn } from "../process/defaultSpawn.js";

/**
 * Thin wrappers around `git` CLI invocations. Synchronous (uses `SpawnFn`
 * port) because every call is a short-lived shell operation. For async
 * long-running ops like `git fetch` against a slow remote, consumers should
 * call the CLI directly via their own `spawn`.
 *
 * Uses raw `git` for portability (no `simple-git` runtime dep).
 */
export interface GitOpsOptions {
  cwd: string;
  spawn?: SpawnFn;
}

const run = (
  { cwd, spawn = defaultSpawn }: GitOpsOptions,
  args: readonly string[],
): { stdout: string; stderr: string; exitCode: number | null } => {
  const result = spawn("git", args, { cwd });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
};

const runOrThrow = (opts: GitOpsOptions, args: readonly string[]): string => {
  const result = run(opts, args);
  if (result.exitCode !== 0) {
    throw new GitCommandError({
      args,
      cwd: opts.cwd,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  return result.stdout;
};

export class GitCommandError extends Error {
  public readonly args: readonly string[];
  public readonly cwd: string;
  public readonly exitCode: number | null;
  public readonly stdout: string;
  public readonly stderr: string;

  constructor(detail: {
    args: readonly string[];
    cwd: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }) {
    super(
      `git ${detail.args.join(" ")} failed with exit ${detail.exitCode} in ${detail.cwd}: ${detail.stderr.trim() || detail.stdout.trim()}`,
    );
    this.name = "GitCommandError";
    this.args = detail.args;
    this.cwd = detail.cwd;
    this.exitCode = detail.exitCode;
    this.stdout = detail.stdout;
    this.stderr = detail.stderr;
  }
}

/** Return `HEAD`'s SHA. */
export const headSha = (opts: GitOpsOptions): string =>
  runOrThrow(opts, ["rev-parse", "HEAD"]).trim();

/** Create and check out a new branch at HEAD. Throws if the branch already exists. */
export const createBranch = (opts: GitOpsOptions, branch: string): void => {
  runOrThrow(opts, ["checkout", "-b", branch]);
};

/**
 * Idempotent branch checkout for retriable steps (openPrStep). Order:
 *   1. local branch exists  -> check it out
 *   2. remote branch exists -> fetch + reset to it (a prior run already pushed
 *      it; adopting it lets the later push fast-forward instead of erroring in
 *      a fresh worktree)
 *   3. otherwise             -> create it at HEAD
 */
export const checkoutOrCreateBranch = (
  opts: GitOpsOptions,
  branch: string,
  remote = "origin",
): void => {
  const localExists =
    run(opts, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).exitCode === 0;
  if (localExists) {
    runOrThrow(opts, ["checkout", branch]);
    return;
  }
  const remoteExists =
    run(opts, ["ls-remote", "--exit-code", "--heads", remote, branch]).exitCode === 0;
  if (remoteExists) {
    runOrThrow(opts, ["fetch", remote, branch]);
    runOrThrow(opts, ["checkout", "-B", branch, "FETCH_HEAD"]);
    return;
  }
  runOrThrow(opts, ["checkout", "-b", branch]);
};

/** `true` when the working tree has uncommitted changes (tracked or untracked). */
export const hasUncommittedChanges = (opts: GitOpsOptions): boolean => {
  const out = runOrThrow(opts, ["status", "--porcelain"]).trim();
  return out.length > 0;
};

/**
 * Stage everything tracked + untracked (respecting `.gitignore`) and commit.
 * Returns the resulting commit SHA, or `null` if the working tree was clean.
 */
export const commitAll = (opts: GitOpsOptions, message: string): string | null => {
  if (!hasUncommittedChanges(opts)) return null;
  runOrThrow(opts, ["add", "-A"]);
  runOrThrow(opts, ["commit", "-m", message]);
  return headSha(opts);
};

/** Push HEAD to the named remote ref. `-u` is set so subsequent pushes track. */
export const pushBranch = (opts: GitOpsOptions, remoteBranch: string, remote = "origin"): void => {
  runOrThrow(opts, ["push", "-u", remote, `HEAD:${remoteBranch}`]);
};

/** Return the unified diff of tracked changes against `baseRef` (default HEAD). */
export const diff = (opts: GitOpsOptions, baseRef = "HEAD"): string =>
  runOrThrow(opts, ["diff", baseRef]);

/**
 * Return the list of changed file paths vs `baseRef`.
 *
 * Uses `-z` (NUL-delimited) on both queries. Without it, git would quote
 * non-ASCII filenames per `core.quotePath`, producing escaped strings that
 * don't round-trip to real filesystem paths — downstream `showFileAtRef` /
 * `readFile` would miss those files and misclassify valid edits as disallowed.
 */
export const changedFiles = (opts: GitOpsOptions, baseRef = "HEAD"): string[] => {
  const splitNul = (raw: string): string[] => raw.split("\0").filter((p) => p.length > 0);
  const tracked = splitNul(runOrThrow(opts, ["diff", "-z", "--name-only", baseRef]));
  const untracked = splitNul(
    runOrThrow(opts, ["ls-files", "-z", "--others", "--exclude-standard"]),
  );
  const set = new Set<string>([...tracked, ...untracked]);
  return [...set];
};

/** Return the text at `path` under revision `ref`, or `null` if absent. */
export const showFileAtRef = (opts: GitOpsOptions, ref: string, path: string): string | null => {
  const res = run(opts, ["show", `${ref}:${path}`]);
  if (res.exitCode !== 0) return null;
  return res.stdout;
};

/**
 * Restore `paths` in the working tree to their state at `ref` (default HEAD).
 * Wrapper over `git checkout <ref> -- <paths…>` that tolerates a mix of
 * tracked + untracked entries: paths that don't exist at `ref` are silently
 * skipped. Without that filter, a single batch `git checkout` fails with
 * `pathspec did not match` and aborts restoration for the entire batch — so
 * passing even one untracked file would break valid restorations alongside.
 *
 * Useful when a step needs to revert specific files without resetting the
 * whole worktree (e.g. an iterate loop where the agent edited source it
 * shouldn't have, alongside untracked test files the iterate also produced).
 *
 * Short-circuits to no-op when `paths` is empty so callers don't have to.
 */
export const restoreFiles = (opts: GitOpsOptions, paths: readonly string[], ref = "HEAD"): void => {
  if (paths.length === 0) return;
  // Filter to the subset that exists at `ref`. `git ls-tree -r --name-only -z`
  // silently omits pathspecs that don't match — non-existent paths just don't
  // appear in the output (no error). Single spawn, NUL-delimited to preserve
  // non-ASCII paths verbatim.
  const lsResult = run(opts, ["ls-tree", "-r", "--name-only", "-z", ref, "--", ...paths]);
  if (lsResult.exitCode !== 0) {
    throw new GitCommandError({
      args: ["ls-tree", "-r", "--name-only", "-z", ref, "--", ...paths],
      cwd: opts.cwd,
      exitCode: lsResult.exitCode,
      stdout: lsResult.stdout,
      stderr: lsResult.stderr,
    });
  }
  const existingAtRef = lsResult.stdout.split("\0").filter((p) => p.length > 0);
  if (existingAtRef.length === 0) return;
  runOrThrow(opts, ["checkout", ref, "--", ...existingAtRef]);
};
