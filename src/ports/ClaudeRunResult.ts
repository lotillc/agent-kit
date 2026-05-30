/**
 * Shared result shape for Claude Code CLI invocations. Defined as a port so
 * adapters/agent-cli/claude/runClaude (PR 2) and any future in-process Agent SDK
 * adapter (ADR-0036, deferred) agree on the surface.
 */
export interface ClaudeRunStats {
  durationMs: number;
  apiDurationMs?: number;
  totalCostUsd?: number;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /**
   * Per-model breakdown. Typed as a mutable `Array` (not `ReadonlyArray`)
   * because composer's `AssertSerializable` rejects `ReadonlyArray` in step
   * return types. Treat as read-only at the consumer boundary.
   */
  perModel?: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  }>;
}

export interface ClaudeCodeResult {
  /**
   * True iff the subprocess exited 0 AND no agent-level error was reported
   * (e.g. `is_error: true` in the result event, billing failure, content-policy
   * block). When `false`, check `errorMessage` for the agent-side reason or
   * `stderr` for the subprocess-side reason.
   */
  success: boolean;
  stdout: string;
  stderr: string;
  /**
   * Subprocess exit code. The runner normalizes signal-only exits to `128`
   * and spawn failures to `127`, so this is always a concrete number.
   */
  exitCode: number;
  /**
   * Signal that terminated the child, if any (e.g. `"SIGTERM"` from a timeout,
   * `"SIGKILL"` from the grace-period force-kill). `null` for normal exits.
   * Matches `SpawnResult.signal` from `SpawnFn` (PR 1).
   */
  signal: NodeJS.Signals | null;
  durationMs: number;
  errorMessage?: string;
  resultText?: string;
  stats?: ClaudeRunStats;
}

export type ClaudeLogLevel = "quiet" | "stderr" | "verbose" | "debug";
