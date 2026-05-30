import type { SpawnFn } from "../../ports/SpawnFn.js";
import { defaultSpawn } from "../process/defaultSpawn.js";

/**
 * Worktree preflight: **dependency setup only**, not git state validation.
 * This runs the install step (pnpm install or a user script) inside a freshly
 * created worktree so the agent doesn't waste turns discovering missing
 * packages. Use the helpers in `simpleGitOps.ts` (`hasUncommittedChanges`,
 * `headSha`) for git-state checks — those are a separate concern.
 *
 * Strategies:
 *   - **`preflight-script`**: run a user-supplied script with the worktree
 *     cwd. Script is responsible for producing a ready-to-use tree.
 *   - **`pnpm-install`**: run `pnpm install --frozen-lockfile --prefer-offline`.
 *   - **`skipped`**: no-op (consumer already primed the worktree).
 */
export type PreflightStrategy = "preflight-script" | "pnpm-install" | "skipped";

export interface PreflightInput {
  worktreePath: string;
  strategy: PreflightStrategy;
  /** Path to the preflight script (required when strategy is `preflight-script`). */
  scriptPath?: string;
  /** Timeout in ms. Default 5 minutes. */
  timeoutMs?: number;
  spawn?: SpawnFn;
}

export interface PreflightResult {
  ok: boolean;
  strategy: PreflightStrategy;
  durationMs: number;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export const preflightWorktree = ({
  worktreePath,
  strategy,
  scriptPath,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawn = defaultSpawn,
}: PreflightInput): PreflightResult => {
  const started = Date.now();

  if (strategy === "skipped") {
    return { ok: true, strategy, durationMs: Date.now() - started };
  }

  if (strategy === "preflight-script") {
    if (!scriptPath) {
      return {
        ok: false,
        strategy,
        durationMs: Date.now() - started,
        error: "preflight strategy is 'preflight-script' but scriptPath was not provided",
      };
    }
    const res = spawn("bash", [scriptPath], { cwd: worktreePath, timeoutMs });
    return makeResult(strategy, started, res.exitCode, res.stderr);
  }

  // pnpm-install
  const res = spawn("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
    cwd: worktreePath,
    timeoutMs,
  });
  return makeResult(strategy, started, res.exitCode, res.stderr);
};

const makeResult = (
  strategy: PreflightStrategy,
  started: number,
  exitCode: number | null,
  stderr: string,
): PreflightResult => ({
  ok: exitCode === 0,
  strategy,
  durationMs: Date.now() - started,
  error: exitCode === 0 ? undefined : stderr.trim() || `preflight exited ${exitCode}`,
});
