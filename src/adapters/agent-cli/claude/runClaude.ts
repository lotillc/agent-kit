import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { createInterface } from "node:readline";

import { redactSecrets } from "../../../domain/redaction/redactSecrets.js";
import type {
  ClaudeCodeResult,
  ClaudeLogLevel,
  ClaudeRunStats,
} from "../../../ports/ClaudeRunResult.js";
import { warnDangerousAutonomy } from "../shared/dangerWarning.js";
import { ensureNodeOnPath } from "../shared/ensurePath.js";

import { type AuthMode, applyEnvOverrides, resolveAuth } from "./auth.js";
import { extractStats } from "./extractStats.js";
import { type ResolvedBinary, resolveClaudeBinary } from "./resolveBinary.js";
import { formatStreamEvent, parseStreamEventLine, type StreamEvent } from "./streamEvents.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const KILL_GRACE_MS = 5_000;
const DEFAULT_HEARTBEAT_MS = 15_000;

/**
 * Function signature matching `node:child_process.spawn`. Exposed as an
 * injection seam so tests can provide a fake ChildProcess without spawning
 * a real subprocess (ADR-0013).
 */
export type SpawnChildFn = typeof nodeSpawn;

/** Minimal structured logger the runner uses for heartbeat + lifecycle logs. */
export interface RunClaudeLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const silentLogger: RunClaudeLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Wrap a logger so every message is scrubbed of credentials before it lands (ADR-0021). */
const withRedactedLogger = (
  logger: RunClaudeLogger,
  maybeSecrets: ReadonlyArray<string | undefined>,
): RunClaudeLogger => {
  const secrets = maybeSecrets.filter((s): s is string => typeof s === "string" && s.length > 0);
  const scrub = (message: string): string => redactSecrets(message, { secrets });
  return {
    info: (m) => logger.info(scrub(m)),
    warn: (m) => logger.warn(scrub(m)),
    error: (m) => logger.error(scrub(m)),
  };
};

export interface ClaudeCodeRunnerOptions {
  /**
   * Anthropic API key. If omitted under `auth: 'auto'`, falls back to the
   * `ANTHROPIC_API_KEY` env var, then to OAuth when neither is set.
   */
  anthropicApiKey?: string;
  /** Timeout in ms. Default 10 minutes. */
  timeoutMs?: number;
  /** Max agentic turns Claude may take per invocation. Omit for no limit. */
  maxTurns?: number;
  /** stderr logging behavior. Default `"stderr"`. */
  logLevel?: ClaudeLogLevel;
  /** When true, use stream-json and emit per-event via `logger` / `onEvent`. */
  streamThinking?: boolean;
  /** Model slug override; omit to let the CLI choose. */
  model?: string;
  /** Additional allowed tools. Cannot combine with `dangerouslySkipPermissions`. */
  allowedTools?: readonly string[];
  /** Forwarded as `--system-prompt` — replaces Claude Code's default. */
  systemPrompt?: string;
  /** Forwarded as `--append-system-prompt` — appended to Claude Code's default. */
  appendSystemPrompt?: string;
  /** Caller cancellation: aborting kills the whole Claude process tree (SIGTERM). */
  signal?: AbortSignal;
  /**
   * Pass `--dangerously-skip-permissions` so Claude can edit files and run
   * tools without prompting. Default **off** (ADR-0022): opt in explicitly, and
   * only under a sandboxed/ephemeral working tree with a post-run diff gate
   * (e.g. `validateWorkingTreeDiff`). A warning is logged whenever it is on.
   */
  dangerouslySkipPermissions?: boolean;
  /** Auth mode. Default `"auto"`: api-key if `anthropicApiKey` or `ANTHROPIC_API_KEY` env is set, else OAuth. */
  auth?: AuthMode;
  /**
   * Interval between heartbeat log lines during long waits. Default 15s. Set
   * to `0` to disable.
   */
  heartbeatIntervalMs?: number;
  /** Called for every successfully-parsed stream-json event. */
  onEvent?: (event: StreamEvent) => void;
  /** Logger for lifecycle, heartbeat, and error messages. */
  logger?: RunClaudeLogger;
  /**
   * Scrub credentials (API keys, tokens) from all log output. Default on
   * (ADR-0021). Set `true` to disable redaction.
   */
  disableRedaction?: boolean;
  /** Override the spawn function (testing seam). */
  spawnChild?: SpawnChildFn;
  /** Override Claude binary resolution (testing seam). */
  resolveBinary?: () => ResolvedBinary;
  /** Override PATH munging (testing seam). */
  ensurePath?: (current: string | undefined) => string;
  /** Override `Date.now()` (testing seam). */
  now?: () => number;
}

/**
 * Spawn the Claude Code CLI as a subprocess, pipe the prompt via stdin, and
 * capture the result (stdout, stderr, exit code, parsed stats).
 *
 * Supports two output modes:
 *   - **`json`** (default): single JSON blob on stdout at the end.
 *   - **`stream-json`** (`streamThinking: true`): real-time line-delimited
 *     events, parsed and forwarded through `onEvent` / `logger`.
 *
 * Consolidates several runner variants into one.
 */
export const runClaudeCode = (
  prompt: string,
  cwd: string,
  options: ClaudeCodeRunnerOptions = {},
): Promise<ClaudeCodeResult> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logLevel = options.logLevel ?? "stderr";
  const streamThinking = options.streamThinking ?? false;
  const dangerouslySkipPermissions = options.dangerouslySkipPermissions ?? false;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
  const spawnImpl = options.spawnChild ?? nodeSpawn;
  const resolveBinaryImpl = options.resolveBinary ?? resolveClaudeBinary;
  const ensurePathImpl = options.ensurePath ?? ensureNodeOnPath;
  const now = options.now ?? Date.now;
  const baseLogger = options.logger ?? silentLogger;
  const logger =
    options.disableRedaction === true
      ? baseLogger
      : withRedactedLogger(baseLogger, [
          options.anthropicApiKey,
          process.env.ANTHROPIC_API_KEY,
          process.env.GITHUB_TOKEN,
          process.env.GH_TOKEN,
        ]);
  const pipeStderr = logLevel !== "quiet";
  const authMode = options.auth ?? "auto";

  // Resolve auth/binary/env up front. These can throw (missing key, claude not
  // on PATH); convert to a rejected-but-resolved failure so the function always
  // honors its `Promise<ClaudeCodeResult>` contract instead of throwing sync.
  let auth: ReturnType<typeof resolveAuth>;
  let binary: ResolvedBinary;
  let env: ReturnType<typeof applyEnvOverrides>;
  try {
    auth = resolveAuth({
      mode: authMode,
      cwd,
      anthropicApiKey: options.anthropicApiKey,
      envApiKey: process.env.ANTHROPIC_API_KEY,
    });
    binary = resolveBinaryImpl();
    env = applyEnvOverrides(
      { ...process.env, CI: "true", PATH: ensurePathImpl(process.env.PATH) },
      auth.envOverrides,
    );
  } catch (err) {
    return Promise.resolve({
      success: false,
      stdout: "",
      stderr: `Failed to set up claude run: ${err instanceof Error ? err.message : String(err)}`,
      exitCode: 127,
      signal: null,
      durationMs: 0,
    });
  }

  const claudeArgs: string[] = ["-p", ...auth.extraArgs];

  if (dangerouslySkipPermissions) {
    warnDangerousAutonomy("--dangerously-skip-permissions");
    claudeArgs.push("--dangerously-skip-permissions");
  } else if (options.allowedTools && options.allowedTools.length > 0) {
    claudeArgs.push("--allowedTools", ...options.allowedTools);
  }

  if (streamThinking) {
    claudeArgs.push("--output-format", "stream-json", "--verbose");
  } else {
    claudeArgs.push("--output-format", "json");
  }

  if (logLevel === "debug") claudeArgs.push("--debug");
  else if (logLevel === "verbose" && !streamThinking) claudeArgs.push("--verbose");

  if (typeof options.maxTurns === "number") {
    claudeArgs.push("--max-turns", String(options.maxTurns));
  }
  if (options.model) {
    claudeArgs.push("--model", options.model);
  }
  if (options.systemPrompt) {
    claudeArgs.push("--system-prompt", options.systemPrompt);
  }
  if (options.appendSystemPrompt) {
    claudeArgs.push("--append-system-prompt", options.appendSystemPrompt);
  }

  const command = binary.command;
  const args = [...binary.prefixArgs, ...claudeArgs];

  const startTime = now();

  logger.info(
    `[claude-code] spawning ${command} (prompt=${prompt.length} chars, maxTurns=${options.maxTurns ?? "∞"}, model=${options.model ?? "default"}, auth=${auth.mode})`,
  );

  return new Promise<ClaudeCodeResult>((resolve) => {
    let child: ChildProcess;
    try {
      // `detached: true` makes the child the leader of its own process group
      // so the timeout handler can signal the WHOLE tree (Claude + any tool
      // subprocesses it spawned) via `process.kill(-pid, sig)`. Without this,
      // a timeout signals only the direct Claude PID and orphans descendants.
      child = spawnImpl(command, args, {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });
    } catch (err) {
      resolve({
        success: false,
        stdout: "",
        stderr: `Failed to spawn claude process: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: 127,
        signal: null,
        durationMs: now() - startTime,
      });
      return;
    }

    const stdinStream = child.stdin;
    if (stdinStream) {
      stdinStream.end(prompt);
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let capturedResultText: string | undefined;
    let capturedErrorMessage: string | undefined;
    let capturedStats: ClaudeRunStats | undefined;
    let resultEventSeen = false;
    let eventCount = 0;
    let turnCount = 0;
    let lastTurnMessageId: string | undefined;
    let childExited = false;
    let timedOut = false;
    let rl: ReturnType<typeof createInterface> | undefined;
    /** Guards against double-settlement when both `close` and `error` fire. */
    let settled = false;

    /**
     * Signal the whole process group so any tool subprocesses Claude spawned
     * also die. `child.kill()` only signals the direct PID. We still call
     * `child.kill()` first so the Node wrapper marks `subprocess.killed = true`
     * and our test harness records the signal, then send to `-pid` for the
     * group. ESRCH is benign — child already exited.
     */
    const killTree = (sig: NodeJS.Signals) => {
      child.kill(sig);
      // Process-group kill uses a negative PID, which is POSIX-only. On Windows
      // `child.kill` above is the portable best-effort; skip the group signal.
      if (child.pid !== undefined && process.platform !== "win32") {
        try {
          process.kill(-child.pid, sig);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== "ESRCH" && code !== "EPERM") throw err;
        }
      }
    };

    const heartbeat =
      heartbeatIntervalMs > 0
        ? setInterval(() => {
            const secs = Math.floor((now() - startTime) / 1000);
            logger.info(`[claude-code] ${secs}s elapsed, ${eventCount} events, turn ${turnCount}`);
          }, heartbeatIntervalMs)
        : null;

    // Line-frame stderr before logging so a credential split across stream
    // chunks is still redacted as a whole line by the logger wrapper (ADR-0021).
    let stderrLogBuffer = "";
    const flushStderrLog = () => {
      if (pipeStderr && stderrLogBuffer.length > 0) {
        logger.info(stderrLogBuffer);
        stderrLogBuffer = "";
      }
    };
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      if (!pipeStderr) return;
      stderrLogBuffer += chunk.toString("utf-8");
      let nl = stderrLogBuffer.indexOf("\n");
      while (nl !== -1) {
        logger.info(stderrLogBuffer.slice(0, nl));
        stderrLogBuffer = stderrLogBuffer.slice(nl + 1);
        nl = stderrLogBuffer.indexOf("\n");
      }
    });

    const handleStreamLine = (line: string): void => {
      stdoutChunks.push(Buffer.from(`${line}\n`));
      const event = parseStreamEventLine(line);
      if (!event) {
        if (line.trim() && pipeStderr) logger.info(line);
        return;
      }
      eventCount += 1;
      if (event.type === "assistant") {
        const messageId = event.message?.id;
        if (!messageId || messageId !== lastTurnMessageId) {
          lastTurnMessageId = messageId;
          turnCount += 1;
          const secs = Math.floor((now() - startTime) / 1000);
          logger.info(`[claude:turn ${turnCount}] (elapsed ${secs}s)`);
        }
      }
      const formatted = formatStreamEvent(event);
      if (formatted) logger.info(formatted);
      options.onEvent?.(event);

      if (event.type === "result") {
        resultEventSeen = true;
        if (event.result) capturedResultText = event.result;
        if (event.is_error && event.result) capturedErrorMessage = event.result;
        capturedStats = extractStats(event, now() - startTime);
      } else if (event.type === "assistant" && event.error) {
        const text = event.message?.content?.[0]?.text;
        capturedErrorMessage = text ?? event.error;
      }
    };

    if (streamThinking && child.stdout) {
      rl = createInterface({ input: child.stdout });
      rl.on("line", handleStreamLine);
    } else {
      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
    }

    // SIGTERM -> SIGKILL grace timer shared by the timeout and abort paths.
    // Tracked so `close`/`error` can clear it — otherwise it keeps the event
    // loop alive for KILL_GRACE_MS after a prompt exit.
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleForceKill = (reason: string) => {
      graceTimer = setTimeout(() => {
        if (!childExited) {
          logger.warn(`[claude-code] still running ${KILL_GRACE_MS}ms after ${reason}, SIGKILL`);
          killTree("SIGKILL");
        }
      }, KILL_GRACE_MS);
    };

    // Caller cancellation: kill the whole tree, same as a timeout. Listener is
    // removed on settle so a long-lived caller signal doesn't leak listeners.
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      logger.warn("[claude-code] aborted by caller, sending SIGTERM");
      killTree("SIGTERM");
      scheduleForceKill("abort");
    };
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      logger.warn(`[claude-code] timed out after ${timeoutMs}ms, sending SIGTERM`);
      killTree("SIGTERM");
      scheduleForceKill("timeout");
    }, timeoutMs);

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      childExited = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      options.signal?.removeEventListener("abort", onAbort);
      if (heartbeat) clearInterval(heartbeat);
      rl?.close();
      flushStderrLog();

      const durationMs = now() - startTime;
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      const exitCode = code ?? (signal ? 128 : 1);

      if (signal) {
        logger.warn(`[claude-code] killed by signal ${signal} after ${durationMs}ms`);
      }

      // Fallback: only when stream parsing missed the result event entirely.
      // An intentionally-empty result event has `resultEventSeen === true` but
      // empty `capturedResultText` — do NOT re-scan stdout in that case.
      if (stdout.trim() && !resultEventSeen) {
        fallbackParseStdout(stdout, durationMs, {
          setResultText: (t) => {
            capturedResultText ??= t;
          },
          setErrorMessage: (t) => {
            capturedErrorMessage ??= t;
          },
          setStats: (s) => {
            capturedStats ??= s;
          },
        });
      }

      if (exitCode !== 0) {
        logger.error(`[claude-code] exited with code ${exitCode} after ${durationMs}ms`);
      }

      // Synthesize an errorMessage on timeout so the caller has a reason even
      // if the agent itself reported nothing — and never let a graceful exit-0
      // after our SIGTERM look like success.
      if (timedOut && capturedErrorMessage === undefined) {
        capturedErrorMessage = `timed out after ${timeoutMs}ms`;
      }
      if (aborted && capturedErrorMessage === undefined) {
        capturedErrorMessage = "aborted by caller";
      }

      // `success` requires a clean subprocess exit, no agent-level error
      // (billing failure, content-policy block — flagged via `is_error: true`
      // in the result event with exit code 0), AND that we did not time out or
      // get cancelled (the child might have trapped SIGTERM and exited cleanly).
      const success = exitCode === 0 && capturedErrorMessage === undefined && !timedOut && !aborted;

      resolve({
        success,
        stdout,
        stderr,
        exitCode,
        signal: signal ?? null,
        durationMs,
        errorMessage: capturedErrorMessage,
        resultText: capturedResultText,
        stats: capturedStats ?? { durationMs },
      });
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      // Mark exited so the SIGKILL inner timer (if armed by a prior timeout)
      // does not fire on an already-dead child.
      childExited = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      options.signal?.removeEventListener("abort", onAbort);
      if (heartbeat) clearInterval(heartbeat);
      rl?.close();
      flushStderrLog();
      const durationMs = now() - startTime;
      logger.error(
        `[claude-code] failed to spawn: ${err instanceof Error ? err.message : String(err)}`,
      );
      resolve({
        success: false,
        stdout: "",
        stderr: `Failed to spawn claude process: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: 127,
        signal: null,
        durationMs,
      });
    });
  });
};

interface FallbackSetters {
  setResultText: (t: string) => void;
  setErrorMessage: (t: string) => void;
  setStats: (s: ClaudeRunStats) => void;
}

const fallbackParseStdout = (
  stdout: string,
  durationMs: number,
  setters: FallbackSetters,
): void => {
  // Try single-blob JSON first (json output mode).
  const whole = parseStreamEventLine(stdout) ?? parseWhole(stdout);
  if (whole) {
    if (whole.result) setters.setResultText(whole.result);
    if (whole.is_error && whole.result) setters.setErrorMessage(whole.result);
    if (whole.type === "result") setters.setStats(extractStats(whole, durationMs));
    return;
  }
  // Otherwise scan line-by-line for a `result` event.
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const event = parseStreamEventLine(line);
    if (event?.type === "result") {
      if (event.result) setters.setResultText(event.result);
      if (event.is_error && event.result) setters.setErrorMessage(event.result);
      setters.setStats(extractStats(event, durationMs));
    }
  }
};

const parseWhole = (stdout: string): StreamEvent | null => {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (parsed === null || typeof parsed !== "object" || !("type" in parsed)) return null;
    return parsed as StreamEvent;
  } catch {
    return null;
  }
};
