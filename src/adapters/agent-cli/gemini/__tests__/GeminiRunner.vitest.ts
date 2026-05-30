import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, test, vi } from "vitest";

import { GeminiRunner } from "../GeminiRunner.js";

class MockChild extends EventEmitter {
  public readonly stdin = null;
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  kill(_signal: NodeJS.Signals | number): boolean {
    return true;
  }
}

const makeHarness = () => {
  let child: MockChild | null = null;
  let observed: { command: string; args: readonly string[] } | null = null;
  const spawn = ((command: string, args: readonly string[]) => {
    observed = { command, args };
    child = new MockChild();
    return child as unknown as ChildProcess;
  }) as unknown as typeof import("node:child_process").spawn;
  return {
    spawn,
    emit: (data: { stdout?: string; stderr?: string }) => {
      if (!child) throw new Error("spawn not called");
      if (data.stdout) child.stdout.emit("data", Buffer.from(data.stdout));
      if (data.stderr) child.stderr.emit("data", Buffer.from(data.stderr));
    },
    close: (code: number) => {
      if (!child) throw new Error("spawn not called");
      child.stdout.end();
      child.stderr.end();
      child.emit("close", code);
    },
    error: (err: Error) => {
      if (!child) throw new Error("spawn not called");
      child.emit("error", err);
    },
    getArgs: () => observed!,
  };
};

describe("GeminiRunner", () => {
  test("invokes gemini with -p and the prompt", async () => {
    const h = makeHarness();
    const runner = new GeminiRunner({ spawnChild: h.spawn });
    const p = runner.runReview("my prompt", "/work");
    h.emit({ stdout: "ok" });
    h.close(0);
    await p;
    expect(h.getArgs().command).toBe("gemini");
    expect(h.getArgs().args).toEqual(["-p", "my prompt"]);
  });

  test("passes --yolo and warns when bypass is opted in", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const h = makeHarness();
    const runner = new GeminiRunner({ spawnChild: h.spawn, dangerouslyBypassApprovals: true });
    const p = runner.runReview("my prompt", "/work");
    h.emit({ stdout: "ok" });
    h.close(0);
    await p;
    expect(h.getArgs().args).toEqual(["--yolo", "-p", "my prompt"]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("gemini --yolo"));
  });

  test("non-zero exit surfaces stderr", async () => {
    const h = makeHarness();
    const runner = new GeminiRunner({ spawnChild: h.spawn });
    const p = runner.runReview("p", "/work");
    h.emit({ stderr: "quota exceeded" });
    h.close(1);
    const result = await p;
    expect(result.success).toBe(false);
    expect(result.error).toContain("quota exceeded");
  });

  test("spawn ENOENT surfaces error message rather than hanging", async () => {
    const h = makeHarness();
    const runner = new GeminiRunner({ spawnChild: h.spawn });
    const p = runner.runReview("p", "/work");
    h.error(new Error("spawn gemini ENOENT"));
    const result = await p;
    expect(result.success).toBe(false);
    expect(result.error).toContain("ENOENT");
  });

  test("a clean exit after caller abort is not reported as success", async () => {
    const h = makeHarness();
    const controller = new AbortController();
    const runner = new GeminiRunner({ spawnChild: h.spawn });
    const p = runner.runReview("p", "/work", controller.signal);
    controller.abort();
    h.close(0);
    const result = await p;
    expect(result.success).toBe(false);
    expect(result.error).toContain("aborted");
  });
});
