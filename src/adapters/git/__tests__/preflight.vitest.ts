import { describe, expect, test, vi } from "vitest";

import type { SpawnFn, SpawnResult } from "../../../ports/SpawnFn.js";
import { preflightWorktree } from "../preflight.js";

const ok = (): SpawnResult => ({ stdout: "", stderr: "", exitCode: 0, signal: null });
const fail = (stderr = "install failed"): SpawnResult => ({
  stdout: "",
  stderr,
  exitCode: 1,
  signal: null,
});

describe("preflightWorktree", () => {
  test("skipped strategy returns ok without spawn", () => {
    const spawn = vi.fn<SpawnFn>();
    const result = preflightWorktree({ worktreePath: "/w", strategy: "skipped", spawn });
    expect(result.ok).toBe(true);
    expect(result.strategy).toBe("skipped");
    expect(spawn).not.toHaveBeenCalled();
  });

  test("pnpm-install calls pnpm install frozen-lockfile", () => {
    const spawn = vi.fn<SpawnFn>().mockReturnValue(ok());
    const result = preflightWorktree({ worktreePath: "/w", strategy: "pnpm-install", spawn });
    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      "pnpm",
      ["install", "--frozen-lockfile", "--prefer-offline"],
      expect.objectContaining({ cwd: "/w" }),
    );
  });

  test("preflight-script requires scriptPath", () => {
    const result = preflightWorktree({ worktreePath: "/w", strategy: "preflight-script" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/scriptPath/);
  });

  test("preflight-script invokes bash with the script", () => {
    const spawn = vi.fn<SpawnFn>().mockReturnValue(ok());
    const result = preflightWorktree({
      worktreePath: "/w",
      strategy: "preflight-script",
      scriptPath: "/setup.sh",
      spawn,
    });
    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      "bash",
      ["/setup.sh"],
      expect.objectContaining({ cwd: "/w" }),
    );
  });

  test("non-zero exit produces error result", () => {
    const spawn = vi.fn<SpawnFn>().mockReturnValue(fail("ENETUNREACH"));
    const result = preflightWorktree({ worktreePath: "/w", strategy: "pnpm-install", spawn });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ENETUNREACH");
  });
});
