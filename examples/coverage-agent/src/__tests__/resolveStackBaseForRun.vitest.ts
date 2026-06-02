import type { OpenPr } from "@lotiai/agent-kit/gh-cli";
import type { SpawnFn, SpawnResult } from "@lotiai/agent-kit/ports";
import { describe, expect, test, vi } from "vitest";

import { resolveStackBaseForRun, StackBaseResolveError } from "../stack/resolveStackBaseForRun.js";

function openPr(overrides: Partial<OpenPr> = {}): OpenPr {
  return {
    number: 1,
    headRefName: "coverage-agent/run/foo",
    headRefOid: "abcdef1234567890abcdef1234567890abcdef12",
    baseRefName: "main",
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * Build a SpawnFn that routes based on the first arg (`fetch`, `rev-parse`,
 * etc.) and records each call for assertions. Unknown invocations fail loud
 * so a regression can't silently pass by returning blanket success.
 */
function makeSpawn(responses: Partial<Record<string, SpawnResult>>): {
  spawn: SpawnFn;
  calls: Array<{ cmd: string; args: readonly string[] }>;
} {
  const calls: Array<{ cmd: string; args: readonly string[] }> = [];
  const spawn: SpawnFn = (cmd, args) => {
    calls.push({ cmd, args });
    const key = args[0] ?? "";
    const response = responses[key];
    if (!response) {
      throw new Error(`unexpected spawn: ${cmd} ${args.join(" ")}`);
    }
    return response;
  };
  return { spawn, calls };
}

describe("resolveStackBaseForRun", () => {
  test("no open PRs → falls back to sandbox branch, still fetches + rev-parses", () => {
    const { spawn, calls } = makeSpawn({
      fetch: { stdout: "", stderr: "", exitCode: 0, signal: null },
      "rev-parse": {
        stdout: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n",
        stderr: "",
        exitCode: 0,
        signal: null,
      },
    });

    const result = resolveStackBaseForRun({
      repoRoot: "/repo",
      sandboxBranch: "main",
      openPrs: [],
      spawn,
    });

    expect(result).toEqual({
      baseBranch: "main",
      baseRef: "origin/main",
      baseSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      isStacked: false,
    });
    // The fetch must target the branch name (not the fully-qualified
    // `origin/main`). `git fetch origin main` materializes the ref
    // locally; `git fetch origin origin/main` would be a no-op / error.
    expect(calls[0]).toEqual({ cmd: "git", args: ["fetch", "origin", "main"] });
    expect(calls[1]).toEqual({ cmd: "git", args: ["rev-parse", "origin/main"] });
  });

  test("open coverage-agent PR → stacks on newest, fetches the prior head branch", () => {
    // Defense-in-depth for the PR #2948 scar: we MUST fetch the prior PR's
    // head branch before forking the worktree. Otherwise `git worktree add
    // --detach origin/coverage-agent/run/...` fails with "not a valid ref"
    // on a cold checkout that never pulled the prior branch.
    const prior = openPr({
      number: 42,
      headRefName: "coverage-agent/run/loti-cli/tools-cli-src-alpha",
    });
    const { spawn, calls } = makeSpawn({
      fetch: { stdout: "", stderr: "", exitCode: 0, signal: null },
      "rev-parse": {
        stdout: "cafebabecafebabecafebabecafebabecafebabe\n",
        stderr: "",
        exitCode: 0,
        signal: null,
      },
    });

    const result = resolveStackBaseForRun({
      repoRoot: "/repo",
      sandboxBranch: "main",
      openPrs: [prior],
      spawn,
    });

    expect(result.baseBranch).toBe("coverage-agent/run/loti-cli/tools-cli-src-alpha");
    expect(result.baseRef).toBe("origin/coverage-agent/run/loti-cli/tools-cli-src-alpha");
    expect(result.baseSha).toBe("cafebabecafebabecafebabecafebabecafebabe");
    expect(result.isStacked).toBe(true);
    expect(calls[0]).toEqual({
      cmd: "git",
      args: ["fetch", "origin", "coverage-agent/run/loti-cli/tools-cli-src-alpha"],
    });
  });

  test("newest PR wins when multiple are open (stacks on top of the stack)", () => {
    const older = openPr({ number: 10, headRefName: "coverage-agent/run/older" });
    const newer = openPr({ number: 99, headRefName: "coverage-agent/run/newer" });
    const { spawn } = makeSpawn({
      fetch: { stdout: "", stderr: "", exitCode: 0, signal: null },
      "rev-parse": {
        stdout: "1111111111111111111111111111111111111111\n",
        stderr: "",
        exitCode: 0,
        signal: null,
      },
    });

    const result = resolveStackBaseForRun({
      repoRoot: "/repo",
      sandboxBranch: "main",
      openPrs: [older, newer],
      spawn,
    });

    expect(result.baseBranch).toBe("coverage-agent/run/newer");
  });

  test("fetch failure throws StackBaseResolveError with stderr surfaced for debuggability", () => {
    const { spawn } = makeSpawn({
      fetch: {
        stdout: "",
        stderr: "fatal: couldn't find remote ref main",
        exitCode: 128,
        signal: null,
      },
    });
    expect(() =>
      resolveStackBaseForRun({
        repoRoot: "/repo",
        sandboxBranch: "main",
        openPrs: [],
        spawn,
      }),
    ).toThrow(StackBaseResolveError);
    expect(() =>
      resolveStackBaseForRun({
        repoRoot: "/repo",
        sandboxBranch: "main",
        openPrs: [],
        spawn,
      }),
    ).toThrow(/git fetch origin main failed.*couldn't find remote ref/s);
  });

  test("rev-parse failure throws (fetch succeeded but ref didn't resolve — weird remote state)", () => {
    const { spawn } = makeSpawn({
      fetch: { stdout: "", stderr: "", exitCode: 0, signal: null },
      "rev-parse": {
        stdout: "",
        stderr: "fatal: ambiguous argument 'origin/main'",
        exitCode: 128,
        signal: null,
      },
    });
    expect(() =>
      resolveStackBaseForRun({
        repoRoot: "/repo",
        sandboxBranch: "main",
        openPrs: [],
        spawn,
      }),
    ).toThrow(/git rev-parse origin\/main failed.*ambiguous argument/s);
  });

  test("rev-parse succeeding with empty stdout is still treated as failure (no SHA to fork from)", () => {
    // This shouldn't happen in practice — git rev-parse of a valid ref
    // always prints a SHA — but defend against it anyway, because
    // passing an empty string to `git worktree add --detach` silently
    // defaults to HEAD, which is the exact behavior we're trying to
    // avoid.
    const { spawn } = makeSpawn({
      fetch: { stdout: "", stderr: "", exitCode: 0, signal: null },
      "rev-parse": { stdout: "  \n", stderr: "", exitCode: 0, signal: null },
    });
    expect(() =>
      resolveStackBaseForRun({
        repoRoot: "/repo",
        sandboxBranch: "main",
        openPrs: [],
        spawn,
      }),
    ).toThrow(/empty stdout/);
  });

  test("custom remote is threaded through to both fetch and rev-parse", () => {
    const { spawn, calls } = makeSpawn({
      fetch: { stdout: "", stderr: "", exitCode: 0, signal: null },
      "rev-parse": {
        stdout: "2222222222222222222222222222222222222222\n",
        stderr: "",
        exitCode: 0,
        signal: null,
      },
    });
    const result = resolveStackBaseForRun({
      repoRoot: "/repo",
      sandboxBranch: "main",
      openPrs: [],
      remote: "upstream",
      spawn,
    });
    expect(result.baseRef).toBe("upstream/main");
    expect(calls[0]).toEqual({ cmd: "git", args: ["fetch", "upstream", "main"] });
    expect(calls[1]).toEqual({ cmd: "git", args: ["rev-parse", "upstream/main"] });
  });

  test("repoRoot is used as cwd for each git spawn (worktree safety)", () => {
    // Important: this MUST run at `repoRoot` (the user's primary checkout)
    // rather than any ephemeral worktree, because the worktree doesn't
    // exist yet when we call this helper — that's the whole point.
    const cwds: Array<string | undefined> = [];
    const spawn: SpawnFn = vi.fn((_cmd, args, opts) => {
      cwds.push(opts?.cwd);
      if (args[0] === "fetch") return { stdout: "", stderr: "", exitCode: 0, signal: null };
      return {
        stdout: "3333333333333333333333333333333333333333\n",
        stderr: "",
        exitCode: 0,
        signal: null,
      };
    });
    resolveStackBaseForRun({
      repoRoot: "/some/repo/root",
      sandboxBranch: "main",
      openPrs: [],
      spawn,
    });
    expect(cwds).toEqual(["/some/repo/root", "/some/repo/root"]);
  });
});
