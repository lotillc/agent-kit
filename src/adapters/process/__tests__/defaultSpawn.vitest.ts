import { describe, expect, test, vi } from "vitest";

import { defaultSpawn } from "../defaultSpawn.js";

describe("defaultSpawn", () => {
  test("captures stdout from a simple command", () => {
    const result = defaultSpawn("node", ["-e", "process.stdout.write('hello')"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello");
    expect(result.stderr).toBe("");
  });

  test("captures stderr and exit code on failure", () => {
    const result = defaultSpawn("node", ["-e", "process.stderr.write('boom');process.exit(2)"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("boom");
  });

  test("forwards stdin when input option is provided", () => {
    const result = defaultSpawn("node", ["-e", "process.stdin.pipe(process.stdout)"], {
      input: "piped",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("piped");
  });

  test("respects cwd option", () => {
    const result = defaultSpawn("node", ["-e", "process.stdout.write(process.cwd())"], {
      cwd: "/",
    });
    expect(result.stdout).toBe("/");
  });

  test("surfaces signal when child is killed by one", () => {
    const result = defaultSpawn("node", ["-e", "process.kill(process.pid, 'SIGKILL')"]);
    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe("SIGKILL");
  });

  test("signal is null on a normal exit", () => {
    const result = defaultSpawn("node", ["-e", "process.exit(0)"]);
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.error).toBeUndefined();
  });

  test("surfaces ENOENT in result.error when the binary does not exist", () => {
    const result = defaultSpawn("definitely-not-a-real-binary-xyz", []);
    expect(result.exitCode).toBeNull();
    expect(result.signal).toBeNull();
    expect(result.error).toBeDefined();
    expect((result.error as NodeJS.ErrnoException).code).toBe("ENOENT");
  });

  test("surfaces timeout via result.error and signal when timeoutMs fires", () => {
    const result = defaultSpawn("node", ["-e", "setTimeout(() => {}, 5000)"], { timeoutMs: 50 });
    expect(result.signal).toBe("SIGKILL");
    expect(result.error).toBeDefined();
  });

  test("env overrides merge with process.env so PATH is preserved", () => {
    // Caller passes { CI: "true" }; the child must still see PATH (otherwise
    // any future `git`/`gh`/`stryker` call would silently fail with ENOENT).
    const result = defaultSpawn(
      "node",
      [
        "-e",
        "process.stdout.write(JSON.stringify({ CI: process.env.CI, hasPath: typeof process.env.PATH === 'string' }))",
      ],
      { env: { CI: "true" } },
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { CI: string; hasPath: boolean };
    expect(parsed.CI).toBe("true");
    expect(parsed.hasPath).toBe(true);
  });

  test("kills a child that traps SIGTERM (uses SIGKILL so timeoutMs is hard)", () => {
    // Regression test: a child that ignores SIGTERM must still be killed
    // within bounded time. Node's default killSignal=SIGTERM would let the
    // child run forever and hang spawnSync; we force SIGKILL.
    const started = Date.now();
    const result = defaultSpawn(
      "node",
      ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
      { timeoutMs: 100 },
    );
    const elapsed = Date.now() - started;
    expect(result.signal).toBe("SIGKILL");
    expect(result.error).toBeDefined();
    // Generous upper bound; the call should return shortly after timeoutMs.
    expect(elapsed).toBeLessThan(2000);
  });

  test("clears an env var set to undefined rather than passing the string 'undefined'", () => {
    vi.stubEnv("AK_CLEAR_ME", "present-in-parent");
    const result = defaultSpawn(
      "node",
      ["-e", "process.stdout.write('AK_CLEAR_ME' in process.env ? 'present' : 'absent')"],
      { env: { AK_CLEAR_ME: undefined } },
    );
    expect(result.stdout).toBe("absent");
  });
});
