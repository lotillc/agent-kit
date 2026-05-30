import type { ClaudeCodeResult } from "../../../ports/ClaudeRunResult.js";

import type { AuthMode } from "./auth.js";
import { type ClaudeCodeRunnerOptions, runClaudeCode } from "./runClaude.js";

/**
 * Opinionated wrapper over `runClaudeCode` for autonomous agentic sites:
 * stream-json with per-turn logging and API key from the caller's env.
 *
 * Autonomy (`--dangerously-skip-permissions`) is **opt-in** via
 * `dangerouslySkipPermissions` and defaults off; enable it only under an
 * ephemeral worktree with a post-run diff gate. The underlying runner logs a
 * warning whenever it is on.
 *
 * This is a thin option-translator only — no retry, no budget gate, no abort
 * support beyond what `runClaudeCode` exposes. Those orchestration concerns
 * belong in the consumer above this layer (composer step, pipeline).
 */
export interface AgenticClaudeOptions {
  maxTurns: number;
  timeoutMs: number;
  model?: string;
  apiKey?: string;
  /** See ClaudeCodeRunnerOptions.auth. Default `"auto"`. */
  auth?: AuthMode;
  /** See ClaudeCodeRunnerOptions.dangerouslySkipPermissions. Default `false`. */
  dangerouslySkipPermissions?: boolean;
  /** See ClaudeCodeRunnerOptions.disableRedaction. Default `false`. */
  disableRedaction?: boolean;
  /** Forwarded to the underlying runner. */
  onEvent?: ClaudeCodeRunnerOptions["onEvent"];
  logger?: ClaudeCodeRunnerOptions["logger"];
}

export const runAgenticClaude = (
  prompt: string,
  cwd: string,
  opts: AgenticClaudeOptions,
): Promise<ClaudeCodeResult> =>
  runClaudeCode(prompt, cwd, {
    anthropicApiKey: opts.apiKey,
    maxTurns: opts.maxTurns,
    timeoutMs: opts.timeoutMs,
    model: opts.model,
    auth: opts.auth,
    streamThinking: true,
    dangerouslySkipPermissions: opts.dangerouslySkipPermissions ?? false,
    disableRedaction: opts.disableRedaction,
    onEvent: opts.onEvent,
    logger: opts.logger,
  });
