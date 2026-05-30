import { describe, expect, test, vi } from "vitest";

import type { SpawnFn, SpawnResult } from "../../../ports/SpawnFn.js";
import {
  changedFiles,
  checkoutOrCreateBranch,
  commitAll,
  createBranch,
  diff,
  GitCommandError,
  hasUncommittedChanges,
  headSha,
  pushBranch,
  restoreFiles,
  showFileAtRef,
} from "../simpleGitOps.js";

const makeSpawn = (
  responses: ReadonlyArray<SpawnResult>,
): { spawn: SpawnFn; calls: Array<{ args: readonly string[] }> } => {
  let i = 0;
  const calls: Array<{ args: readonly string[] }> = [];
  const spawn: SpawnFn = (_cmd, args) => {
    calls.push({ args });
    return responses[i++] ?? responses[responses.length - 1]!;
  };
  return { spawn, calls };
};

const ok = (stdout = ""): SpawnResult => ({ stdout, stderr: "", exitCode: 0, signal: null });
const fail = (stderr = "boom", exitCode = 1): SpawnResult => ({
  stdout: "",
  stderr,
  exitCode,
  signal: null,
});

describe("headSha", () => {
  test("returns trimmed SHA", () => {
    const { spawn } = makeSpawn([ok("abc123\n")]);
    expect(headSha({ cwd: "/repo", spawn })).toBe("abc123");
  });

  test("throws GitCommandError on non-zero exit", () => {
    const { spawn } = makeSpawn([fail("bad repo")]);
    expect(() => headSha({ cwd: "/repo", spawn })).toThrow(GitCommandError);
  });
});

describe("createBranch", () => {
  test("invokes git checkout -b", () => {
    const { spawn, calls } = makeSpawn([ok()]);
    createBranch({ cwd: "/repo", spawn }, "feat/x");
    expect(calls[0]!.args).toEqual(["checkout", "-b", "feat/x"]);
  });
});

describe("checkoutOrCreateBranch", () => {
  test("switches to an existing branch (idempotent retry path)", () => {
    // rev-parse --verify exits 0 → branch exists → checkout (no -b).
    const { spawn, calls } = makeSpawn([ok("deadbeef\n"), ok()]);
    checkoutOrCreateBranch({ cwd: "/repo", spawn }, "feat/x");
    expect(calls[0]!.args).toEqual(["rev-parse", "--verify", "--quiet", "refs/heads/feat/x"]);
    expect(calls[1]!.args).toEqual(["checkout", "feat/x"]);
  });

  test("creates the branch when neither local nor remote has it", () => {
    // rev-parse exits 1 (no local) → ls-remote exits 2 (no remote) → checkout -b.
    const { spawn, calls } = makeSpawn([fail("", 1), fail("", 2), ok()]);
    checkoutOrCreateBranch({ cwd: "/repo", spawn }, "feat/y");
    expect(calls[1]!.args).toEqual(["ls-remote", "--exit-code", "--heads", "origin", "feat/y"]);
    expect(calls[2]!.args).toEqual(["checkout", "-b", "feat/y"]);
  });

  test("adopts an existing remote branch so the later push fast-forwards", () => {
    // No local branch, but the remote has it (prior run pushed): fetch + reset.
    const { spawn, calls } = makeSpawn([fail("", 1), ok("sha\trefs/heads/feat/z\n"), ok(), ok()]);
    checkoutOrCreateBranch({ cwd: "/repo", spawn }, "feat/z");
    expect(calls[1]!.args).toEqual(["ls-remote", "--exit-code", "--heads", "origin", "feat/z"]);
    expect(calls[2]!.args).toEqual(["fetch", "origin", "feat/z"]);
    expect(calls[3]!.args).toEqual(["checkout", "-B", "feat/z", "FETCH_HEAD"]);
  });
});

describe("hasUncommittedChanges", () => {
  test("false when status --porcelain is empty", () => {
    const { spawn } = makeSpawn([ok("")]);
    expect(hasUncommittedChanges({ cwd: "/repo", spawn })).toBe(false);
  });

  test("true when there is output", () => {
    const { spawn } = makeSpawn([ok(" M src/foo.ts\n?? new.txt\n")]);
    expect(hasUncommittedChanges({ cwd: "/repo", spawn })).toBe(true);
  });
});

describe("commitAll", () => {
  test("returns null when tree is clean", () => {
    const { spawn } = makeSpawn([ok("")]); // status --porcelain
    expect(commitAll({ cwd: "/repo", spawn }, "msg")).toBeNull();
  });

  test("stages, commits, returns SHA when dirty", () => {
    const { spawn, calls } = makeSpawn([
      ok("?? new.txt\n"), // status --porcelain
      ok(), // add -A
      ok(), // commit -m
      ok("deadbeef\n"), // rev-parse HEAD
    ]);
    const sha = commitAll({ cwd: "/repo", spawn }, "msg");
    expect(sha).toBe("deadbeef");
    expect(calls.map((c) => c.args[0])).toEqual(["status", "add", "commit", "rev-parse"]);
  });
});

describe("pushBranch", () => {
  test("invokes git push -u origin HEAD:<branch>", () => {
    const { spawn, calls } = makeSpawn([ok()]);
    pushBranch({ cwd: "/repo", spawn }, "feat/x");
    expect(calls[0]!.args).toEqual(["push", "-u", "origin", "HEAD:feat/x"]);
  });
});

describe("diff", () => {
  test("returns stdout of git diff", () => {
    const { spawn } = makeSpawn([ok("@@ -1 +1 @@\n-a\n+b\n")]);
    expect(diff({ cwd: "/repo", spawn })).toContain("@@ -1 +1 @@");
  });
});

describe("changedFiles", () => {
  test("dedupes tracked + untracked from NUL-delimited git output", () => {
    // git output uses \0 as separator (and trailing \0). Multiple separators
    // empty-string-split fine because we filter empty entries.
    const { spawn } = makeSpawn([ok("a.ts\0b.ts\0"), ok("b.ts\0c.ts\0")]);
    const files = changedFiles({ cwd: "/repo", spawn });
    expect(files.sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  test("preserves non-ASCII paths verbatim (no quotePath mangling)", () => {
    // With `git diff --name-only` (no `-z`), git would quote "héllo.ts" as
    // `"h\\303\\251llo.ts"`. With `-z` + NUL-delimited parse, the byte sequence
    // is preserved end-to-end so `readFile(path)` actually finds the file.
    const { spawn } = makeSpawn([ok("héllo.ts\0"), ok("")]);
    const files = changedFiles({ cwd: "/repo", spawn });
    expect(files).toEqual(["héllo.ts"]);
  });

  test("passes `-z` to both diff and ls-files (regression: avoid quotePath mangling)", () => {
    const calls: string[][] = [];
    const { spawn } = makeSpawn([
      { stdout: "", stderr: "", exitCode: 0, signal: null },
      { stdout: "", stderr: "", exitCode: 0, signal: null },
    ]);
    const wrapped: SpawnFn = (cmd, args, opts) => {
      calls.push([...args]);
      return spawn(cmd, args, opts);
    };
    changedFiles({ cwd: "/repo", spawn: wrapped });
    expect(calls[0]).toContain("-z");
    expect(calls[1]).toContain("-z");
  });
});

describe("showFileAtRef", () => {
  test("returns file contents on success", () => {
    const { spawn } = makeSpawn([ok("file contents")]);
    expect(showFileAtRef({ cwd: "/repo", spawn }, "HEAD", "foo.ts")).toBe("file contents");
  });

  test("returns null when git show fails (file deleted / missing)", () => {
    const { spawn } = makeSpawn([fail("does not exist", 128)]);
    expect(showFileAtRef({ cwd: "/repo", spawn }, "HEAD", "foo.ts")).toBeNull();
  });
});

describe("restoreFiles", () => {
  test("filters paths via ls-tree then checks out the existing subset", () => {
    // 1st spawn: ls-tree returns the input paths NUL-delimited (both exist).
    // 2nd spawn: checkout succeeds.
    const { spawn, calls } = makeSpawn([ok("a.ts\0b.ts\0"), ok()]);
    restoreFiles({ cwd: "/repo", spawn }, ["a.ts", "b.ts"]);
    expect(calls[0]!.args).toEqual([
      "ls-tree",
      "-r",
      "--name-only",
      "-z",
      "HEAD",
      "--",
      "a.ts",
      "b.ts",
    ]);
    expect(calls[1]!.args).toEqual(["checkout", "HEAD", "--", "a.ts", "b.ts"]);
  });

  test("accepts a custom ref (threads through both ls-tree and checkout)", () => {
    const { spawn, calls } = makeSpawn([ok("a.ts\0"), ok()]);
    restoreFiles({ cwd: "/repo", spawn }, ["a.ts"], "deadbeef");
    expect(calls[0]!.args).toEqual([
      "ls-tree",
      "-r",
      "--name-only",
      "-z",
      "deadbeef",
      "--",
      "a.ts",
    ]);
    expect(calls[1]!.args).toEqual(["checkout", "deadbeef", "--", "a.ts"]);
  });

  test("no-op when paths is empty (does not spawn)", () => {
    const spawn = vi.fn<SpawnFn>();
    restoreFiles({ cwd: "/repo", spawn }, []);
    expect(spawn).not.toHaveBeenCalled();
  });

  test("silently skips untracked/missing paths from a mixed batch (regression)", () => {
    // Agent created `new-test.ts` (doesn't exist at HEAD) and modified
    // `existing.ts` (does exist at HEAD). A naive single-checkout call would
    // fail with `pathspec did not match` for `new-test.ts` and abort the
    // restore of `existing.ts` too. We must still restore the tracked one.
    const { spawn, calls } = makeSpawn([ok("existing.ts\0"), ok()]);
    restoreFiles({ cwd: "/repo", spawn }, ["existing.ts", "new-test.ts"]);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.args).toEqual(["checkout", "HEAD", "--", "existing.ts"]);
  });

  test("does not call checkout when every input path is untracked", () => {
    // ls-tree returns empty → nothing to restore → skip the checkout entirely.
    const { spawn, calls } = makeSpawn([ok(""), ok()]);
    restoreFiles({ cwd: "/repo", spawn }, ["new1.ts", "new2.ts"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0]).toBe("ls-tree");
  });

  test("throws GitCommandError when ls-tree fails (bad ref, broken repo, etc.)", () => {
    const { spawn } = makeSpawn([fail("fatal: not a valid object name HEAD", 128)]);
    expect(() => restoreFiles({ cwd: "/repo", spawn }, ["a.ts"])).toThrow(GitCommandError);
  });

  test("throws GitCommandError when checkout fails on the filtered subset", () => {
    // ls-tree succeeds with a tracked path; checkout itself fails (e.g.
    // permission error). We surface that.
    const { spawn } = makeSpawn([ok("a.ts\0"), fail("permission denied", 1)]);
    expect(() => restoreFiles({ cwd: "/repo", spawn }, ["a.ts"])).toThrow(GitCommandError);
  });
});

describe("GitCommandError", () => {
  test("includes exit code and stderr in message", () => {
    const err = new GitCommandError({
      args: ["status"],
      cwd: "/repo",
      exitCode: 128,
      stdout: "",
      stderr: "fatal: not a repo",
    });
    expect(err.message).toContain("128");
    expect(err.message).toContain("fatal: not a repo");
    expect(err.message).toContain("/repo");
  });

  test("spies see the right args passed to spawn", () => {
    const spawnSpy = vi.fn<SpawnFn>().mockReturnValue(ok("x"));
    headSha({ cwd: "/repo", spawn: spawnSpy });
    expect(spawnSpy).toHaveBeenCalledWith("git", ["rev-parse", "HEAD"], { cwd: "/repo" });
  });
});
