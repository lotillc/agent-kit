import { describe, expect, test, vi } from "vitest";

import type { SpawnFn, SpawnResult } from "../../../ports/SpawnFn.js";
import { createRollbackTag, formatRollbackTag, rollbackToTag } from "../rollbackTag.js";

const ok = (stdout = ""): SpawnResult => ({ stdout, stderr: "", exitCode: 0, signal: null });

describe("formatRollbackTag", () => {
  test("embeds runId and iteration", () => {
    expect(formatRollbackTag("run-1", 3)).toBe("workflow/pre-iterate/run-1/3");
  });
});

describe("createRollbackTag", () => {
  test("tags current HEAD and returns tag name", () => {
    let call = 0;
    const spawn: SpawnFn = (_cmd, args) => {
      call += 1;
      // 1: rev-parse HEAD
      if (args[0] === "rev-parse") return ok("deadbeef\n");
      // 2: git tag <tag> <sha>
      if (args[0] === "tag") return ok();
      throw new Error(`unexpected: ${args.join(" ")}`);
    };
    const tag = createRollbackTag({ cwd: "/repo", runId: "r1", iteration: 2, spawn });
    expect(tag).toBe("workflow/pre-iterate/r1/2");
    expect(call).toBe(2);
  });

  test("uses explicit sha when provided", () => {
    const spawn = vi.fn<SpawnFn>().mockReturnValue(ok());
    createRollbackTag({ cwd: "/repo", runId: "r1", iteration: 0, sha: "cafef00d", spawn });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      "git",
      ["tag", "workflow/pre-iterate/r1/0", "cafef00d"],
      expect.objectContaining({ cwd: "/repo" }),
    );
  });

  test("force: true passes -f to git tag (resumed-workflow path)", () => {
    const spawn = vi.fn<SpawnFn>().mockReturnValue(ok());
    createRollbackTag({
      cwd: "/repo",
      runId: "r1",
      iteration: 0,
      sha: "cafef00d",
      force: true,
      spawn,
    });
    expect(spawn).toHaveBeenCalledWith(
      "git",
      ["tag", "-f", "workflow/pre-iterate/r1/0", "cafef00d"],
      expect.objectContaining({ cwd: "/repo" }),
    );
  });
});

describe("rollbackToTag", () => {
  test("runs git reset --hard <tag> AND git clean -fd to remove untracked artifacts", () => {
    const spawn = vi.fn<SpawnFn>().mockReturnValue(ok());
    rollbackToTag({ cwd: "/repo", runId: "r1", iteration: 1, spawn });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[0]?.[1]).toEqual(["reset", "--hard", "workflow/pre-iterate/r1/1"]);
    expect(spawn.mock.calls[1]?.[1]).toEqual(["clean", "-fd"]);
  });
});
