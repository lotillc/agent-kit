import { describe, expect, test, vi } from "vitest";

import type { SpawnFn, SpawnResult } from "../../../ports/SpawnFn.js";
import { createPr } from "../createPr.js";

const ok = (stdout: string): SpawnResult => ({ stdout, stderr: "", exitCode: 0, signal: null });
const fail = (stderr: string): SpawnResult => ({ stdout: "", stderr, exitCode: 1, signal: null });

describe("createPr", () => {
  test("returns prUrl + prNumber on successful github.com PR creation", () => {
    const spawn = vi.fn<SpawnFn>().mockReturnValue(ok("https://github.com/owner/repo/pull/42\n"));
    const result = createPr({
      cwd: "/work",
      title: "feat: x",
      body: "body content",
      baseBranch: "main",
      spawn,
    });
    expect(result.ok).toBe(true);
    expect(result.prUrl).toBe("https://github.com/owner/repo/pull/42");
    expect(result.prNumber).toBe(42);
  });

  test("returns prUrl + prNumber on GHES hostname (hostname-agnostic parse)", () => {
    const spawn = vi
      .fn<SpawnFn>()
      .mockReturnValue(ok("https://github.corp.example.com/o/r/pull/777\n"));
    const result = createPr({
      cwd: "/work",
      title: "t",
      body: "b",
      baseBranch: "main",
      spawn,
    });
    expect(result.ok).toBe(true);
    expect(result.prUrl).toBe("https://github.corp.example.com/o/r/pull/777");
    expect(result.prNumber).toBe(777);
  });

  test("non-zero exit returns ok=false with stderr preserved", () => {
    const spawn = vi.fn<SpawnFn>().mockReturnValue(fail("auth failure"));
    const result = createPr({
      cwd: "/work",
      title: "t",
      body: "b",
      baseBranch: "main",
      spawn,
    });
    expect(result.ok).toBe(false);
    expect(result.prUrl).toBeNull();
    expect(result.prNumber).toBeNull();
    expect(result.stderr).toBe("auth failure");
  });

  test("ENOENT on gh spawn surfaces as ok=false with diagnostic stderr", () => {
    const spawn = vi.fn<SpawnFn>().mockReturnValue({
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
      error: Object.assign(new Error("spawn gh ENOENT"), {
        code: "ENOENT",
      }) as NodeJS.ErrnoException,
    });
    const result = createPr({
      cwd: "/work",
      title: "t",
      body: "b",
      baseBranch: "main",
      spawn,
    });
    expect(result.ok).toBe(false);
    expect(result.prUrl).toBeNull();
    expect(result.stderr).toContain("ENOENT");
  });

  test("forwards --draft and --label flags when supplied", () => {
    const spawn = vi.fn<SpawnFn>().mockReturnValue(ok("https://github.com/o/r/pull/1\n"));
    createPr({
      cwd: "/w",
      title: "t",
      body: "b",
      baseBranch: "main",
      draft: true,
      labels: ["bot", "stacked"],
      spawn,
    });
    const args = spawn.mock.calls[0]?.[1] as string[];
    expect(args).toContain("--draft");
    expect(args.filter((a) => a === "--label")).toHaveLength(2);
    expect(args).toContain("bot");
    expect(args).toContain("stacked");
  });

  test("stdout with no recognizable URL returns ok=true but prUrl=null (caller must guard)", () => {
    const spawn = vi.fn<SpawnFn>().mockReturnValue(ok("unexpected gh output format"));
    const result = createPr({
      cwd: "/w",
      title: "t",
      body: "b",
      baseBranch: "main",
      spawn,
    });
    expect(result.ok).toBe(true);
    expect(result.prUrl).toBeNull();
    expect(result.prNumber).toBeNull();
  });
});
