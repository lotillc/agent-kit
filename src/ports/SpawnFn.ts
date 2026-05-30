/**
 * Testability seam for subprocess invocation.
 *
 * All toolkit code that spawns child processes goes through this port so tests
 * can inject a recorded/canned implementation and never touch a real process.
 *
 * Synchronous by design — blocking spawn fits git, gh, stryker, and the other
 * step-local operations that use this port. The Claude Code runner (PR 2)
 * spawns asynchronously in its own adapter and does NOT go through SpawnFn.
 *
 * See ADR-0013 (unit-only test strategy).
 */
export interface SpawnResult {
  stdout: string;
  stderr: string;
  /** Process exit code; `null` when the child was terminated by a signal or never started. */
  exitCode: number | null;
  /** Set when the child exited due to a signal (e.g. `"SIGKILL"` from `timeoutMs`). */
  signal: NodeJS.Signals | null;
  /**
   * Set when the OS-level spawn itself failed (ENOENT, EMFILE, etc.) or when
   * `timeoutMs` killed the process. Consumers MUST check this before reading
   * `exitCode`/`signal` — a spawn that never started has `exitCode: null` and
   * `signal: null`, indistinguishable from other terminal states without this.
   */
  error?: NodeJS.ErrnoException;
}

export interface SpawnOptions {
  cwd?: string;
  /**
   * Environment-variable overrides. **Merged** with `process.env` by
   * `defaultSpawn` — passing `{ CI: "true" }` keeps PATH and the rest of the
   * parent env. To clear a var, set it to `undefined` (it will be filtered).
   */
  env?: NodeJS.ProcessEnv;
  input?: string;
  /**
   * Hard timeout in ms. When the deadline fires the child is sent SIGKILL
   * (NOT SIGTERM — a child that traps SIGTERM would otherwise hang the
   * synchronous `spawnSync` call indefinitely). Consumers needing a polite
   * SIGTERM→grace→SIGKILL ladder should use an async spawn wrapper.
   */
  timeoutMs?: number;
  maxBuffer?: number;
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options?: SpawnOptions,
) => SpawnResult;
