import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { describe, expect, test, vi } from "vitest";
import { runClaudeCode } from "../runClaude.js";
import type { StreamEvent } from "../streamEvents.js";

const fixturesRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../__fixtures__/stream-json",
);

const readFixture = (name: string): string => readFileSync(resolve(fixturesRoot, name), "utf-8");

interface FakeProcessHarness {
  spawn: typeof import("node:child_process").spawn;
  emit: (data: { stdout?: string; stderr?: string }) => void;
  close: (code: number | null, signal?: NodeJS.Signals | null) => void;
  /** Emit an `error` event on the child (simulates spawn failure mid-flight). */
  error: (err: Error) => void;
  getArgsSeen: () => { command: string; args: readonly string[]; env: NodeJS.ProcessEnv };
  getStdinWrites: () => string[];
  /** Signals delivered to the child in the order `kill` was invoked. */
  getKillSignals: () => ReadonlyArray<NodeJS.Signals | number>;
}

/**
 * Build a fake `spawn` implementation that returns a controllable ChildProcess.
 * Tests drive emit/close manually to simulate stream behavior without a real
 * subprocess (ADR-0013).
 */
const makeFakeSpawn = (): FakeProcessHarness => {
  let child: MockChild | null = null;
  let observed: { command: string; args: readonly string[]; env: NodeJS.ProcessEnv } | null = null;
  const stdinWrites: string[] = [];

  const spawn = ((
    command: string,
    args: readonly string[],
    options: { env?: NodeJS.ProcessEnv },
  ) => {
    observed = { command, args, env: options.env ?? {} };
    child = new MockChild();
    child.stdin._onWrite = (chunk: string) => stdinWrites.push(chunk);
    return child as unknown as ChildProcess;
  }) as unknown as typeof import("node:child_process").spawn;

  return {
    spawn,
    emit: ({ stdout, stderr }) => {
      if (!child) throw new Error("spawn not called yet");
      if (stdout !== undefined) child.stdout.emit("data", Buffer.from(stdout));
      if (stderr !== undefined) child.stderr.emit("data", Buffer.from(stderr));
    },
    close: (code, signal) => {
      if (!child) throw new Error("spawn not called yet");
      child.stdout.end();
      child.stderr.end();
      child.emit("close", code, signal ?? null);
    },
    error: (err) => {
      if (!child) throw new Error("spawn not called yet");
      child.emit("error", err);
    },
    getArgsSeen: () => {
      if (!observed) throw new Error("spawn not called yet");
      return observed;
    },
    getStdinWrites: () => stdinWrites,
    getKillSignals: () => {
      if (!child) throw new Error("spawn not called yet");
      return child.killSignals;
    },
  };
};

/**
 * NOTE ON TEST ASYNC REALISM: the harness emits `data` on a PassThrough
 * synchronously. `readline` buffers and emits `line` events in the same tick,
 * so stream-json parsing in tests completes without awaiting microtasks. In
 * production, `data` arrives in OS micro-batches and `line` can be deferred
 * by one or more microtasks. The runner is written so turn-count +
 * stats-capture are stable regardless, but any future change that adds
 * ordering-sensitive logic should add an async-await to verify.
 */
class MockChild extends EventEmitter {
  public readonly stdin = new FakeStdin();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public killed = false;
  public readonly killSignals: (NodeJS.Signals | number)[] = [];

  kill(signal: NodeJS.Signals | number): boolean {
    this.killSignals.push(signal);
    this.killed = true;
    return true;
  }
}

class FakeStdin {
  public _onWrite: (chunk: string) => void = () => undefined;

  write(chunk: string): boolean {
    this._onWrite(chunk);
    return true;
  }

  end(chunk?: string): void {
    if (chunk !== undefined) this._onWrite(chunk);
  }
}

const stubBinary = () => ({ command: "/fake/claude", prefixArgs: [] as readonly string[] });

const stubEnsurePath = (p: string | undefined) => p ?? "";

const noopLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe("runClaudeCode", () => {
  test("emits -p and omits --dangerously-skip-permissions by default", async () => {
    const harness = makeFakeSpawn();
    const promise = runClaudeCode("hello", "/work", {
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
      auth: "oauth",
    });
    harness.emit({ stdout: readFixture("simple-success.jsonl") });
    harness.close(0);
    const result = await promise;
    expect(result.success).toBe(true);
    const { args } = harness.getArgsSeen();
    expect(args).toContain("-p");
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
  });

  test("emits --dangerously-skip-permissions only when opted in, and warns", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const harness = makeFakeSpawn();
    const promise = runClaudeCode("hello", "/work", {
      dangerouslySkipPermissions: true,
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
      auth: "oauth",
    });
    harness.emit({ stdout: readFixture("simple-success.jsonl") });
    harness.close(0);
    await promise;
    expect(harness.getArgsSeen().args).toContain("--dangerously-skip-permissions");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("--dangerously-skip-permissions enabled"),
    );
  });

  test("redacts secrets from logged stderr by default", async () => {
    const logs: string[] = [];
    const capturingLogger = {
      info: (m: string) => logs.push(m),
      warn: () => undefined,
      error: () => undefined,
    };
    const harness = makeFakeSpawn();
    const promise = runClaudeCode("hello", "/work", {
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: capturingLogger,
      heartbeatIntervalMs: 0,
      auth: "oauth",
    });
    harness.emit({ stderr: "leaked sk-ant-abcdEFGH12345678 here" });
    harness.emit({ stdout: readFixture("simple-success.jsonl") });
    harness.close(0);
    await promise;
    const joined = logs.join("\n");
    expect(joined).not.toContain("sk-ant-abcdEFGH12345678");
    expect(joined).toContain("[REDACTED]");
  });

  test("redacts a secret split across stderr chunks (line-framed)", async () => {
    const logs: string[] = [];
    const capturingLogger = {
      info: (m: string) => logs.push(m),
      warn: () => undefined,
      error: () => undefined,
    };
    const harness = makeFakeSpawn();
    const promise = runClaudeCode("hello", "/work", {
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: capturingLogger,
      heartbeatIntervalMs: 0,
      auth: "oauth",
    });
    // Secret straddles two data events; only the assembled line matches.
    harness.emit({ stderr: "leak sk-ant-abcd" });
    harness.emit({ stderr: "EFGH12345678 done\n" });
    harness.emit({ stdout: readFixture("simple-success.jsonl") });
    harness.close(0);
    await promise;
    const joined = logs.join("\n");
    expect(joined).not.toContain("sk-ant-abcdEFGH12345678");
    expect(joined).toContain("[REDACTED]");
  });

  test("returns a failed result (not a synchronous throw) when binary resolution fails", async () => {
    const result = await runClaudeCode("hi", "/work", {
      resolveBinary: () => {
        throw new Error("claude not found");
      },
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
      auth: "oauth",
    });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain("claude not found");
  });

  test("stream-json mode parses per-event and invokes onEvent", async () => {
    const harness = makeFakeSpawn();
    const events: StreamEvent[] = [];
    const promise = runClaudeCode("prompt", "/work", {
      streamThinking: true,
      auth: "oauth",
      onEvent: (e) => events.push(e),
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
    });
    harness.emit({ stdout: readFixture("simple-success.jsonl") });
    harness.close(0);
    const result = await promise;

    expect(result.success).toBe(true);
    expect(events.length).toBe(6);
    expect(events[0]?.type).toBe("system");
    expect(events.at(-1)?.type).toBe("result");
    expect(result.resultText).toBe("Analysis complete.");
    expect(result.stats?.totalCostUsd).toBe(0.0234);
    expect(result.stats?.numTurns).toBe(2);
    expect(result.stats?.inputTokens).toBe(1500);
  });

  test("stream-json verbose flag is added alongside stream-json output-format", async () => {
    const harness = makeFakeSpawn();
    const promise = runClaudeCode("p", "/work", {
      streamThinking: true,
      auth: "oauth",
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
    });
    harness.close(0);
    await promise;
    const { args } = harness.getArgsSeen();
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--verbose");
  });

  test("counts turns by message id (multiple partials share one turn)", async () => {
    const harness = makeFakeSpawn();
    const events: StreamEvent[] = [];
    const promise = runClaudeCode("p", "/work", {
      streamThinking: true,
      auth: "oauth",
      onEvent: (e) => events.push(e),
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
    });
    harness.emit({ stdout: readFixture("partial-streaming.jsonl") });
    harness.close(0);
    const result = await promise;

    expect(result.success).toBe(true);
    // Fixture has msg_turn1 (3 partials), msg_turn2 (1). Result event reports num_turns=2.
    expect(result.stats?.numTurns).toBe(2);
  });

  test("bare auth emits --bare --add-dir and sets API key env", async () => {
    const harness = makeFakeSpawn();
    const promise = runClaudeCode("p", "/work", {
      auth: "bare",
      anthropicApiKey: "sk-test",
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
    });
    harness.close(0);
    await promise;
    const { args, env } = harness.getArgsSeen();
    expect(args).toContain("--bare");
    expect(args).toContain("--add-dir");
    expect(args).toContain("/work");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-test");
  });

  test("oauth auth unsets ANTHROPIC_API_KEY even if parent has one", async () => {
    const harness = makeFakeSpawn();
    const priorKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-stale";
    try {
      const promise = runClaudeCode("p", "/work", {
        auth: "oauth",
        spawnChild: harness.spawn,
        resolveBinary: stubBinary,
        ensurePath: stubEnsurePath,
        logger: noopLogger,
        heartbeatIntervalMs: 0,
      });
      harness.close(0);
      await promise;
      const { env } = harness.getArgsSeen();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = priorKey;
    }
  });

  test("prompt is piped via stdin (ADR guards against arg-escaping issues)", async () => {
    const harness = makeFakeSpawn();
    const promise = runClaudeCode("my prompt body", "/work", {
      auth: "oauth",
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
    });
    harness.close(0);
    await promise;
    expect(harness.getStdinWrites()).toEqual(["my prompt body"]);
    // Prompt must NOT appear in argv.
    const { args } = harness.getArgsSeen();
    expect(args.join(" ")).not.toContain("my prompt body");
  });

  test("maxTurns and model flags pass through", async () => {
    const harness = makeFakeSpawn();
    const promise = runClaudeCode("p", "/work", {
      auth: "oauth",
      maxTurns: 5,
      model: "claude-opus-4-6",
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
    });
    harness.close(0);
    await promise;
    const { args } = harness.getArgsSeen();
    expect(args).toContain("--max-turns");
    expect(args).toContain("5");
    expect(args).toContain("--model");
    expect(args).toContain("claude-opus-4-6");
  });

  test("systemPrompt and appendSystemPrompt forward to CLI flags", async () => {
    const harness = makeFakeSpawn();
    const promise = runClaudeCode("p", "/work", {
      auth: "oauth",
      systemPrompt: "you are a planner",
      appendSystemPrompt: "also be terse",
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
    });
    harness.close(0);
    await promise;
    const { args } = harness.getArgsSeen();
    expect(args).toContain("--system-prompt");
    expect(args).toContain("you are a planner");
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("also be terse");
  });

  test("allowedTools is only used when dangerouslySkipPermissions=false", async () => {
    const harness = makeFakeSpawn();
    const promise = runClaudeCode("p", "/work", {
      auth: "oauth",
      dangerouslySkipPermissions: false,
      allowedTools: ["Read", "Grep"],
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
    });
    harness.close(0);
    await promise;
    const { args } = harness.getArgsSeen();
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args).toContain("--allowedTools");
    expect(args).toContain("Read");
    expect(args).toContain("Grep");
  });

  test("captures error message from billing-error fixture", async () => {
    const harness = makeFakeSpawn();
    const promise = runClaudeCode("p", "/work", {
      streamThinking: true,
      auth: "oauth",
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
    });
    harness.emit({ stdout: readFixture("billing-error.jsonl") });
    harness.close(0);
    const result = await promise;
    expect(result.errorMessage).toBe("Your credit is insufficient.");
    expect(result.stats?.numTurns).toBe(1);
    // Subprocess exited 0 but the result event flagged is_error — success must
    // reflect the agent-level failure, not just the subprocess exit.
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  test("falls back to JSON-blob parsing when not in stream mode", async () => {
    const harness = makeFakeSpawn();
    const singleBlob = JSON.stringify({
      type: "result",
      result: "done",
      total_cost_usd: 0.02,
      duration_ms: 1500,
      num_turns: 1,
      modelUsage: { "claude-sonnet-4-6": { inputTokens: 50, outputTokens: 10 } },
    });
    const promise = runClaudeCode("p", "/work", {
      auth: "oauth",
      streamThinking: false,
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
    });
    harness.emit({ stdout: singleBlob });
    harness.close(0);
    const result = await promise;
    expect(result.resultText).toBe("done");
    expect(result.stats?.totalCostUsd).toBe(0.02);
    expect(result.stats?.inputTokens).toBe(50);
  });

  test("timeout triggers SIGTERM and records failure + signal field", async () => {
    vi.useFakeTimers();
    try {
      const harness = makeFakeSpawn();
      const promise = runClaudeCode("p", "/work", {
        auth: "oauth",
        timeoutMs: 100,
        spawnChild: harness.spawn,
        resolveBinary: stubBinary,
        ensurePath: stubEnsurePath,
        logger: noopLogger,
        heartbeatIntervalMs: 0,
      });
      vi.advanceTimersByTime(101);
      expect(harness.getKillSignals()).toEqual(["SIGTERM"]);
      harness.close(null, "SIGTERM");
      vi.useRealTimers();
      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(128);
      expect(result.signal).toBe("SIGTERM");
    } finally {
      vi.useRealTimers();
    }
  });

  test("caller abort signal kills the tree and records failure", async () => {
    const harness = makeFakeSpawn();
    const controller = new AbortController();
    const promise = runClaudeCode("p", "/work", {
      auth: "oauth",
      signal: controller.signal,
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
    });
    controller.abort();
    expect(harness.getKillSignals()).toEqual(["SIGTERM"]);
    harness.close(null, "SIGTERM");
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/aborted/i);
  });

  test("clears the abort grace timer when the child exits promptly", async () => {
    vi.useFakeTimers();
    try {
      const harness = makeFakeSpawn();
      const controller = new AbortController();
      const promise = runClaudeCode("p", "/work", {
        auth: "oauth",
        signal: controller.signal,
        spawnChild: harness.spawn,
        resolveBinary: stubBinary,
        ensurePath: stubEnsurePath,
        logger: noopLogger,
        heartbeatIntervalMs: 0,
      });
      controller.abort();
      expect(harness.getKillSignals()).toEqual(["SIGTERM"]);
      harness.close(null, "SIGTERM"); // child exits promptly after SIGTERM
      vi.advanceTimersByTime(5_000); // grace window elapses
      // No SIGKILL: the grace timer was cleared on close (no 5s event-loop tail).
      expect(harness.getKillSignals()).toEqual(["SIGTERM"]);
      vi.useRealTimers();
      const result = await promise;
      expect(result.success).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("caller abort escalates to SIGKILL if the child traps SIGTERM", async () => {
    vi.useFakeTimers();
    try {
      const harness = makeFakeSpawn();
      const controller = new AbortController();
      const promise = runClaudeCode("p", "/work", {
        auth: "oauth",
        signal: controller.signal,
        spawnChild: harness.spawn,
        resolveBinary: stubBinary,
        ensurePath: stubEnsurePath,
        logger: noopLogger,
        heartbeatIntervalMs: 0,
      });
      controller.abort();
      expect(harness.getKillSignals()).toEqual(["SIGTERM"]);
      // Child traps SIGTERM and keeps running; after the grace window it's SIGKILLed.
      vi.advanceTimersByTime(5_000);
      expect(harness.getKillSignals()).toEqual(["SIGTERM", "SIGKILL"]);
      harness.close(null, "SIGKILL");
      vi.useRealTimers();
      const result = await promise;
      expect(result.success).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("SIGKILL fires after KILL_GRACE_MS if child did not exit after SIGTERM", async () => {
    vi.useFakeTimers();
    try {
      const harness = makeFakeSpawn();
      const promise = runClaudeCode("p", "/work", {
        auth: "oauth",
        timeoutMs: 100,
        spawnChild: harness.spawn,
        resolveBinary: stubBinary,
        ensurePath: stubEnsurePath,
        logger: noopLogger,
        heartbeatIntervalMs: 0,
      });
      // First timer: SIGTERM at 100ms.
      vi.advanceTimersByTime(100);
      expect(harness.getKillSignals()).toEqual(["SIGTERM"]);
      // Second timer: SIGKILL 5s later if child still alive.
      vi.advanceTimersByTime(5_000);
      expect(harness.getKillSignals()).toEqual(["SIGTERM", "SIGKILL"]);
      harness.close(null, "SIGKILL");
      vi.useRealTimers();
      const result = await promise;
      expect(result.signal).toBe("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });

  test("timed-out run reports success=false even if child exited 0 (SIGTERM-trapped)", async () => {
    vi.useFakeTimers();
    try {
      const harness = makeFakeSpawn();
      const promise = runClaudeCode("p", "/work", {
        auth: "oauth",
        timeoutMs: 100,
        spawnChild: harness.spawn,
        resolveBinary: stubBinary,
        ensurePath: stubEnsurePath,
        logger: noopLogger,
        heartbeatIntervalMs: 0,
      });
      vi.advanceTimersByTime(101);
      expect(harness.getKillSignals()).toEqual(["SIGTERM"]);
      // Simulate a SIGTERM-trapping child that swallows the signal and exits cleanly.
      harness.close(0);
      vi.useRealTimers();
      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toMatch(/timed out after 100ms/);
    } finally {
      vi.useRealTimers();
    }
  });

  test("error event resolves with exit=127 and signal=null", async () => {
    const harness = makeFakeSpawn();
    const promise = runClaudeCode("p", "/work", {
      auth: "oauth",
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
    });
    harness.error(new Error("ENOENT: spawn failed"));
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(127);
    expect(result.signal).toBeNull();
    expect(result.stderr).toContain("ENOENT");
  });

  test("error + close firing in sequence does not double-resolve", async () => {
    const harness = makeFakeSpawn();
    const promise = runClaudeCode("p", "/work", {
      auth: "oauth",
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
    });
    harness.error(new Error("boom"));
    harness.close(1);
    const result = await promise;
    // First settlement (error) wins; no second resolve corrupts the shape.
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain("boom");
  });

  test("normal exit records signal=null", async () => {
    const harness = makeFakeSpawn();
    const promise = runClaudeCode("p", "/work", {
      auth: "oauth",
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
    });
    harness.close(0);
    const result = await promise;
    expect(result.signal).toBeNull();
    expect(result.success).toBe(true);
  });

  test("success=false when exit code is non-zero", async () => {
    const harness = makeFakeSpawn();
    const promise = runClaudeCode("p", "/work", {
      auth: "oauth",
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
    });
    harness.emit({ stderr: "oops" });
    harness.close(1);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("oops");
  });

  test("uses binary prefixArgs to invoke cli.js via node", async () => {
    const harness = makeFakeSpawn();
    const promise = runClaudeCode("p", "/work", {
      auth: "oauth",
      spawnChild: harness.spawn,
      resolveBinary: () => ({ command: "/usr/bin/node", prefixArgs: ["/path/to/cli.js"] }),
      ensurePath: stubEnsurePath,
      logger: noopLogger,
      heartbeatIntervalMs: 0,
    });
    harness.close(0);
    await promise;
    const { command, args } = harness.getArgsSeen();
    expect(command).toBe("/usr/bin/node");
    expect(args[0]).toBe("/path/to/cli.js");
    expect(args).toContain("-p");
  });

  test("sets CI=true and honors ensurePath for subprocess env", async () => {
    const harness = makeFakeSpawn();
    let pathArg: string | undefined;
    const promise = runClaudeCode("p", "/work", {
      auth: "oauth",
      spawnChild: harness.spawn,
      resolveBinary: stubBinary,
      ensurePath: (current) => {
        pathArg = current;
        return `/injected${current ? `:${current}` : ""}`;
      },
      logger: noopLogger,
      heartbeatIntervalMs: 0,
    });
    harness.close(0);
    await promise;
    expect(pathArg).toBeDefined();
    const { env } = harness.getArgsSeen();
    expect(env.CI).toBe("true");
    expect(env.PATH?.startsWith("/injected")).toBe(true);
  });
});
