import { describe, expect, test, vi } from "vitest";

import type { SpawnFn, SpawnResult } from "../../../ports/SpawnFn.js";
import { listOpenPrs } from "../listOpenPrs.js";

const ok = (stdout: string): SpawnResult => ({ stdout, stderr: "", exitCode: 0, signal: null });
const fail = (): SpawnResult => ({ stdout: "", stderr: "auth", exitCode: 1, signal: null });

describe("listOpenPrs", () => {
  test("parses a valid gh pr list response", () => {
    const body = JSON.stringify([
      {
        number: 1,
        headRefName: "feat/x",
        headRefOid: "sha1",
        baseRefName: "main",
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        number: 2,
        headRefName: "feat/y",
        headRefOid: "sha2",
        baseRefName: "main",
      },
    ]);
    const spawn = vi.fn<SpawnFn>().mockReturnValue(ok(body));
    const prs = listOpenPrs({ cwd: "/r", label: "my-agent", spawn });
    expect(prs).toHaveLength(2);
    expect(prs[0]!.number).toBe(1);
    expect(prs[1]!.createdAt).toBeUndefined();
  });

  test("returns [] when gh exits non-zero", () => {
    const spawn = vi.fn<SpawnFn>().mockReturnValue(fail());
    expect(listOpenPrs({ cwd: "/r", label: "a", spawn })).toEqual([]);
  });

  test("returns [] when gh output is malformed JSON", () => {
    const spawn = vi.fn<SpawnFn>().mockReturnValue(ok("not json"));
    expect(listOpenPrs({ cwd: "/r", label: "a", spawn })).toEqual([]);
  });

  test("returns [] when gh output does not match the schema", () => {
    const spawn = vi
      .fn<SpawnFn>()
      .mockReturnValue(ok(JSON.stringify([{ number: "not-a-number" }])));
    expect(listOpenPrs({ cwd: "/r", label: "a", spawn })).toEqual([]);
  });

  test("passes --label and --limit to gh", () => {
    const spawn = vi.fn<SpawnFn>().mockReturnValue(ok("[]"));
    listOpenPrs({ cwd: "/r", label: "cov", limit: 10, spawn });
    const args = spawn.mock.calls[0]![1] as readonly string[];
    expect(args).toContain("--label");
    expect(args).toContain("cov");
    expect(args).toContain("--limit");
    expect(args).toContain("10");
  });
});
