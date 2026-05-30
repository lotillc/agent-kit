import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SpawnFn } from "../../ports/SpawnFn.js";
import { defaultSpawn } from "../process/defaultSpawn.js";

import { GitCommandError } from "./simpleGitOps.js";

/**
 * Ephemeral git-worktree lifecycle (create → use → cleanup).
 *
 * The marker file pattern lets a secondary command (validate, open-pr)
 * discover the worktree path from a prior command (invoke-claude) without
 * passing state through env vars.
 */
export interface CreateWorktreeInput {
  repoRoot: string;
  baseRef: string;
  spawn?: SpawnFn;
  /** Override for the temp-dir root (testing seam). Defaults to `os.tmpdir()`. */
  tmpRoot?: string;
}

export interface CreateWorktreeResult {
  worktreePath: string;
}

export const createEphemeralWorktree = ({
  repoRoot,
  baseRef,
  spawn = defaultSpawn,
  tmpRoot,
}: CreateWorktreeInput): CreateWorktreeResult => {
  const worktreePath = mkdtempSync(join(tmpRoot ?? tmpdir(), "agent-kit-wt-"));
  const result = spawn("git", ["worktree", "add", "--detach", worktreePath, baseRef], {
    cwd: repoRoot,
  });
  if (result.exitCode !== 0) {
    // Clean up the empty dir so we don't leak.
    rmSync(worktreePath, { recursive: true, force: true });
    throw new GitCommandError({
      args: ["worktree", "add", "--detach", worktreePath, baseRef],
      cwd: repoRoot,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  return { worktreePath };
};

export interface RemoveWorktreeInput {
  repoRoot: string;
  worktreePath: string;
  keep?: boolean;
  spawn?: SpawnFn;
  /**
   * Called on `git worktree remove` failures so callers can log / observe
   * without aborting cleanup. Filesystem and prune passes still run.
   */
  onRemoveError?: (info: { exitCode: number | null; stderr: string }) => void;
}

/**
 * Best-effort cleanup. Removes the worktree registration, deletes the
 * filesystem path, and prunes stale entries. Subprocess failures surface via
 * `onRemoveError` rather than throwing — callers usually run this in a
 * `finally` and cannot abort their pipeline on cleanup failures, but they DO
 * want to know about orphaned registrations in CI.
 */
export const removeWorktree = ({
  repoRoot,
  worktreePath,
  keep = false,
  spawn = defaultSpawn,
  onRemoveError,
}: RemoveWorktreeInput): void => {
  if (keep) return;
  const removeResult = spawn("git", ["worktree", "remove", "--force", worktreePath], {
    cwd: repoRoot,
  });
  if (removeResult.exitCode !== 0) {
    onRemoveError?.({ exitCode: removeResult.exitCode, stderr: removeResult.stderr });
  }
  // Second pass: prune whichever end didn't clean up.
  rmSync(worktreePath, { recursive: true, force: true });
  spawn("git", ["worktree", "prune"], { cwd: repoRoot });
};

/**
 * Marker-file handshake: the primary command writes the worktree path to a
 * known location; follow-up commands read it.
 */
export const writeWorktreeMarker = (markerPath: string, worktreePath: string): void => {
  writeFileSync(markerPath, worktreePath, "utf-8");
};

export const readWorktreeMarker = (markerPath: string): string | null => {
  try {
    return readFileSync(markerPath, "utf-8").trim();
  } catch {
    return null;
  }
};

export const removeWorktreeMarker = (markerPath: string): void => {
  rmSync(markerPath, { force: true });
};
