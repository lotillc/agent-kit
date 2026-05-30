/**
 * Abstraction over where the Claude Code CLI runs: local subprocess, sandbox container,
 * remote worker, etc.
 *
 * v1 ships LocalExecutionEnvironment. DockerExecutionEnvironment is a plausible
 * future adapter once a consumer needs it.
 */
import type { ClaudeCodeResult } from "./ClaudeRunResult.js";

export interface ExecutionEnvironment {
  setup(worktreePath: string): Promise<void>;
  runClaudeCode(prompt: string, worktreePath: string): Promise<ClaudeCodeResult>;
  teardown(worktreePath: string): Promise<void>;
}
