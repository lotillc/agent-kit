import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, test, vi } from "vitest";

import { CodexRunner } from "../CodexRunner.js";

class MockChild extends EventEmitter {
  public readonly stdin = null;
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly killSignals: (NodeJS.Signals | number)[] = [];
  kill(signal: NodeJS.Signals | number): boolean {
    this.killSignals.push(signal);
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

describe("CodexRunner", () => {
  test("invokes codex with -q and the prompt by default (no approval bypass)", async () => {
    const h = makeHarness();
    const runner = new CodexRunner({ spawnChild: h.spawn });
    const p = runner.runReview("my prompt", "/work");
    h.emit({ stdout: "ok" });
    h.close(0);
    const result = await p;
    expect(result.success).toBe(true);
    expect(h.getArgs().command).toBe("codex");
    expect(h.getArgs().args).toEqual(["-q", "my prompt"]);
    expect(result.rawOutput).toBe("ok");
  });

  test("passes --approval-mode never and warns when bypass is opted in", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const h = makeHarness();
    const runner = new CodexRunner({ spawnChild: h.spawn, dangerouslyBypassApprovals: true });
    const p = runner.runReview("my prompt", "/work");
    h.emit({ stdout: "ok" });
    h.close(0);
    await p;
    expect(h.getArgs().args).toEqual(["-q", "--approval-mode", "never", "my prompt"]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("codex --approval-mode never"));
  });

  test("non-zero exit surfaces stderr as the error", async () => {
    const h = makeHarness();
    const runner = new CodexRunner({ spawnChild: h.spawn });
    const p = runner.runReview("p", "/work");
    h.emit({ stderr: "bad prompt" });
    h.close(1);
    const result = await p;
    expect(result.success).toBe(false);
    expect(result.error).toContain("bad prompt");
  });

  test("error event resolves to a failed result with the error message", async () => {
    const h = makeHarness();
    const runner = new CodexRunner({ spawnChild: h.spawn });
    const p = runner.runReview("p", "/work");
    h.error(new Error("ENOENT"));
    const result = await p;
    expect(result.success).toBe(false);
    expect(result.error).toBe("ENOENT");
  });

  test("exposes configurable runner name", () => {
    expect(new CodexRunner({ name: "my-codex" }).name).toBe("my-codex");
    expect(new CodexRunner().name).toBe("codex");
  });

  test("a clean exit after caller abort is not reported as success", async () => {
    const h = makeHarness();
    const controller = new AbortController();
    const runner = new CodexRunner({ spawnChild: h.spawn });
    const p = runner.runReview("p", "/work", controller.signal);
    controller.abort();
    h.close(0); // CLI exits 0 even though we asked it to stop
    const result = await p;
    expect(result.success).toBe(false);
    expect(result.error).toContain("aborted");
  });
});
