import { spawnSync } from "node:child_process";

import type { SpawnFn, SpawnOptions, SpawnResult } from "../../ports/SpawnFn.js";

const ONE_HUNDRED_MB = 100 * 1024 * 1024;

/**
 * Merge env overrides onto `process.env`. A key set to `undefined` is removed
 * (cleared) rather than passed through as the literal string "undefined" —
 * the contract documented on `SpawnOptions.env`.
 */
const mergeEnv = (overrides: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv => {
  if (overrides === undefined) return process.env;
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged;
};

/**
 * Default SpawnFn adapter. Uses node:child_process.spawnSync.
 *
 * Synchronous because most toolkit adapters (git, gh, stryker) treat subprocess
 * execution as a blocking step. The Claude Code runner spawns asynchronously
 * inside its own adapter and does NOT use this port.
 *
 * `timeoutMs` is enforced via `killSignal: "SIGKILL"` — Node's default
 * `SIGTERM` is interceptable, and `spawnSync` then blocks indefinitely waiting
 * for a child that ignores it. `timeoutMs` is documented as a hard cap, so we
 * deliver it. Consumers that need a polite shutdown ladder should use an async
 * spawn wrapper (the Claude runner ships one).
 */
export const defaultSpawn: SpawnFn = (command, args, options: SpawnOptions = {}): SpawnResult => {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    // Merge with `process.env` so partial overrides like `{ CI: "true" }` don't
    // drop PATH and cause silent ENOENT for git/gh/stryker (execa's "extend
    // env" default, not Node's "replace"). Keys set to `undefined` are cleared,
    // not stringified to "undefined".
    env: mergeEnv(options.env),
    input: options.input,
    encoding: "utf8",
    stdio: options.input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    timeout: options.timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: options.maxBuffer ?? ONE_HUNDRED_MB,
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status,
    signal: result.signal ?? null,
    ...(result.error !== undefined ? { error: result.error } : {}),
  };
};
