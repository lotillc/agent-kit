import type { SpawnFn } from "@lotiai/agent-kit/ports";
import { defaultSpawn } from "@lotiai/agent-kit/process";

export type LintRunOptions = {
  configPath: string;
  targetFile: string;
  cwd: string;
  eslintBinPath: string;
  spawn?: SpawnFn;
};

export type LintRunResult = {
  passed: boolean;
  /** null when the child was killed by a signal (see `@lotiai/agent-kit/ports` SpawnResult). */
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

// Runs eslint with a scoped config containing only eslint-plugin-vitest rules.
// Used to catch anti-patterns (no assertions, mocking the module under test,
// tautological assertions, etc.) without affecting repo-wide lint.
//
// Invokes the eslint CLI directly via `node <eslintBinPath>` rather than
// `pnpm exec eslint`, because ephemeral worktrees may not have eslint hoisted
// to the root `node_modules/.bin/`.
export function runAntiPatternLint(options: LintRunOptions): LintRunResult {
  const spawn = options.spawn ?? defaultSpawn;
  const args = [
    options.eslintBinPath,
    "--no-config-lookup",
    "--config",
    options.configPath,
    options.targetFile,
  ];
  const res = spawn(process.execPath, args, { cwd: options.cwd });
  return {
    passed: res.exitCode === 0,
    exitCode: res.exitCode,
    stdout: res.stdout,
    stderr: res.stderr,
  };
}
