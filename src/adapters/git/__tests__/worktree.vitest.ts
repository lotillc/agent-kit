import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";

import type { SpawnFn, SpawnResult } from "../../../ports/SpawnFn.js";
import { GitCommandError } from "../simpleGitOps.js";
import {
  createEphemeralWorktree,
  readWorktreeMarker,
  removeWorktree,
  removeWorktreeMarker,
  writeWorktreeMarker,
} from "../worktree.js";

const ok = (): SpawnResult => ({ stdout: "", stderr: "", exitCode: 0, signal: null });
const fail = (stderr = "boom"): SpawnResult => ({
  stdout: "",
  stderr,
  exitCode: 128,
  signal: null,
});

describe("createEphemeralWorktree", () => {
  test("invokes `git worktree add --detach` with the chosen tmpdir path", () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "agent-kit-test-"));
    try {
      const spawn = vi.fn<SpawnFn>().mockReturnValue(ok());
      const result = createEphemeralWorktree({
        repoRoot: "/repo",
        baseRef: "abc1234",
        spawn,
        tmpRoot,
      });
      expect(result.worktreePath.startsWith(tmpRoot)).toBe(true);
      expect(spawn).toHaveBeenCalledWith(
        "git",
        ["worktree", "add", "--detach", result.worktreePath, "abc1234"],
        expect.objectContaining({ cwd: "/repo" }),
      );
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("cleans up the temp dir and throws GitCommandError when `git worktree add` fails", () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "agent-kit-test-"));
    try {
      const spawn = vi.fn<SpawnFn>().mockReturnValue(fail("fatal: invalid ref"));
      expect(() =>
        createEphemeralWorktree({
          repoRoot: "/repo",
          baseRef: "nonexistent",
          spawn,
          tmpRoot,
        }),
      ).toThrow(GitCommandError);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe("removeWorktree", () => {
  test("calls `git worktree remove --force` and then `git worktree prune`", () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "agent-kit-test-"));
    try {
      const spawn = vi.fn<SpawnFn>().mockReturnValue(ok());
      removeWorktree({ repoRoot: "/repo", worktreePath: tmpRoot, spawn });
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(spawn.mock.calls[0]?.[1]).toEqual(["worktree", "remove", "--force", tmpRoot]);
      expect(spawn.mock.calls[1]?.[1]).toEqual(["worktree", "prune"]);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("keep: true skips git + filesystem cleanup entirely", () => {
    const spawn = vi.fn<SpawnFn>();
    removeWorktree({ repoRoot: "/repo", worktreePath: "/somewhere", keep: true, spawn });
    expect(spawn).not.toHaveBeenCalled();
  });

  test("surfaces git failures via onRemoveError without throwing", () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "agent-kit-test-"));
    try {
      const spawn = vi
        .fn<SpawnFn>()
        .mockReturnValueOnce(fail("worktree not registered"))
        .mockReturnValueOnce(ok());
      const errors: Array<{ exitCode: number | null; stderr: string }> = [];
      removeWorktree({
        repoRoot: "/repo",
        worktreePath: tmpRoot,
        spawn,
        onRemoveError: (info) => errors.push(info),
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]?.exitCode).toBe(128);
      expect(errors[0]?.stderr).toBe("worktree not registered");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("tolerates a missing filesystem path on second-pass cleanup", () => {
    const spawn = vi.fn<SpawnFn>().mockReturnValue(ok());
    expect(() =>
      removeWorktree({ repoRoot: "/repo", worktreePath: "/nonexistent/path/xyz", spawn }),
    ).not.toThrow();
  });
});

describe("worktree marker", () => {
  test("round-trips path through write/read/remove", () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "agent-kit-test-"));
    const markerPath = join(tmpRoot, "marker.txt");
    try {
      writeWorktreeMarker(markerPath, "/some/worktree");
      expect(readWorktreeMarker(markerPath)).toBe("/some/worktree");
      removeWorktreeMarker(markerPath);
      expect(readWorktreeMarker(markerPath)).toBeNull();
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("readWorktreeMarker returns null when marker file does not exist", () => {
    expect(readWorktreeMarker("/nonexistent/marker/path")).toBeNull();
  });

  test("trims trailing whitespace from marker contents", () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "agent-kit-test-"));
    const markerPath = join(tmpRoot, "marker.txt");
    try {
      writeFileSync(markerPath, "/some/path\n");
      expect(readWorktreeMarker(markerPath)).toBe("/some/path");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
