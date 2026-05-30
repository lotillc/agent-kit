import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { ClaudeRunner } from "../ClaudeRunner.js";
import type { ClaudeCodeRunnerOptions } from "../runClaude.js";

class MockChild extends EventEmitter {
  readonly stdin = { write: () => true, end: () => undefined };
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  readonly killSignals: (NodeJS.Signals | number)[] = [];
  kill(signal: NodeJS.Signals | number): boolean {
    this.killSignals.push(signal);
    this.killed = true;
    return true;
  }
}

const makeHarness = () => {
  let child: MockChild | null = null;
  const spawn = (() => {
    child = new MockChild();
    return child as unknown as ChildProcess;
  }) as unknown as typeof import("node:child_process").spawn;
  return {
    spawn,
    emitLine: (line: string) => child?.stdout.emit("data", Buffer.from(`${line}\n`)),
    close: (code: number | null, signal?: NodeJS.Signals | null) => {
      child?.stdout.end();
      child?.stderr.end();
      child?.emit("close", code, signal ?? null);
    },
    killSignals: () => child?.killSignals ?? [],
  };
};

const runnerOptions = (spawn: ClaudeCodeRunnerOptions["spawnChild"]): ClaudeCodeRunnerOptions => ({
  auth: "oauth",
  spawnChild: spawn,
  resolveBinary: () => ({ command: "/fake/claude", prefixArgs: [] }),
  ensurePath: (p?: string) => p ?? "",
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  heartbeatIntervalMs: 0,
});

describe("ClaudeRunner", () => {
  it("surfaces token counts from the run stats", async () => {
    const harness = makeHarness();
    const runner = new ClaudeRunner({ runnerOptions: runnerOptions(harness.spawn) });
    const promise = runner.runReview("p", "/work");
    harness.emitLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "done",
        total_cost_usd: 0.05,
        duration_ms: 1234,
        num_turns: 1,
        modelUsage: {
          "claude-x": {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 20,
            cacheCreationInputTokens: 10,
          },
        },
      }),
    );
    harness.close(0, null);
    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.tokens).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheCreationTokens: 10,
    });
    expect(result.costUsd).toBeCloseTo(0.05, 6);
  });

  it("forwards caller cancellation to the subprocess (kills the tree)", async () => {
    const harness = makeHarness();
    const runner = new ClaudeRunner({ runnerOptions: runnerOptions(harness.spawn) });
    const controller = new AbortController();
    const promise = runner.runGenerate("p", "/work", controller.signal);
    controller.abort();
    expect(harness.killSignals()).toEqual(["SIGTERM"]);
    harness.close(null, "SIGTERM");
    const result = await promise;
    expect(result.success).toBe(false);
  });

  it("surfaces the setup-failure reason instead of a bare exit code", async () => {
    const runner = new ClaudeRunner({
      runnerOptions: {
        auth: "oauth",
        resolveBinary: () => {
          throw new Error("claude not found");
        },
      },
    });
    const result = await runner.runReview("p", "/work");
    expect(result.success).toBe(false);
    expect(result.error).toContain("claude not found");
  });
});
