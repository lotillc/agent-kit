import type { spawn as nodeSpawn } from "node:child_process";

/**
 * Async-spawn seam for CLI runners (Claude, Codex, Gemini, …). Distinct from
 * the SpawnFn port — async over EventEmitter for runners that stream stdout.
 * Defined once here so each new runner doesn't redeclare it; consumers
 * implementing a mock satisfy `typeof nodeSpawn` directly.
 */
export type SpawnChildFn = typeof nodeSpawn;
