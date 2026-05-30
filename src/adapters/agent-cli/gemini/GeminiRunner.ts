import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";

import type { ModelRunner, ModelRunResult } from "../../../ports/ModelRunner.js";
import { warnDangerousAutonomy } from "../shared/dangerWarning.js";
import type { SpawnChildFn } from "../shared/spawnChild.js";

/**
 * Google `gemini` CLI wrapper conforming to `ModelRunner`.
 *
 * Invokes `gemini -p "<prompt>"`. Auto-approval (`--yolo`) is opt-in via
 * `dangerouslyBypassApprovals` and defaults off. Same fail-fast semantics as
 * `CodexRunner`.
 */

export interface GeminiRunnerOptions {
  name?: string;
  /** Timeout in ms. Default 5 minutes. */
  timeoutMs?: number;
  /**
   * Pass `--yolo` so gemini auto-approves all actions. Default **off**; enable
   * only under a sandboxed/ephemeral working tree. A warning is logged whenever
   * it is on.
   */
  dangerouslyBypassApprovals?: boolean;
  spawnChild?: SpawnChildFn;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export class GeminiRunner implements ModelRunner {
  public readonly name: string;
  private readonly opts: GeminiRunnerOptions;

  constructor(opts: GeminiRunnerOptions = {}) {
    this.name = opts.name ?? "gemini";
    this.opts = opts;
    if (opts.dangerouslyBypassApprovals) warnDangerousAutonomy("gemini --yolo");
  }

  runReview(prompt: string, workingDir: string, abortSignal?: AbortSignal): Promise<ModelRunResult> {
    return this.runOnce(prompt, workingDir, abortSignal);
  }

  runGenerate(
    prompt: string,
    workingDir: string,
    abortSignal?: AbortSignal,
  ): Promise<ModelRunResult> {
    return this.runOnce(prompt, workingDir, abortSignal);
  }

  private runOnce(
    prompt: string,
    workingDir: string,
    abortSignal?: AbortSignal,
  ): Promise<ModelRunResult> {
    const spawnImpl = this.opts.spawnChild ?? nodeSpawn;
    const now = this.opts.now ?? Date.now;
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const started = now();
    const geminiArgs = this.opts.dangerouslyBypassApprovals
      ? ["--yolo", "-p", prompt]
      : ["-p", prompt];

    return new Promise<ModelRunResult>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawnImpl("gemini", geminiArgs, {
          cwd: workingDir,
          stdio: ["ignore", "pipe", "pipe"],
          // Own process group so a timeout/abort can signal the whole tree.
          detached: true,
        });
      } catch (err) {
        resolve({
          success: false,
          rawOutput: "",
          durationMs: now() - started,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      // Signal the whole process group on POSIX so tool subprocesses also die;
      // `child.kill` alone only signals the direct PID. Negative-PID is POSIX-only.
      const killTree = (sig: NodeJS.Signals) => {
        child.kill(sig);
        if (child.pid !== undefined && process.platform !== "win32") {
          try {
            process.kill(-child.pid, sig);
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code !== "ESRCH" && code !== "EPERM") throw err;
          }
        }
      };

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;
      let timedOut = false;
      let aborted = false;

      child.stdout?.on("data", (c: Buffer) => stdoutChunks.push(c));
      child.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));

      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const scheduleForceKill = () => {
        killTimer ??= setTimeout(() => {
          if (!settled) killTree("SIGKILL");
        }, 5_000);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        killTree("SIGTERM");
        scheduleForceKill();
      }, timeoutMs);

      // Caller cancellation (e.g. consensus deadline): kill the tree instead of
      // leaving it running and billing after the caller has moved on.
      const onAbort = () => {
        aborted = true;
        killTree("SIGTERM");
        scheduleForceKill();
      };
      if (abortSignal) {
        if (abortSignal.aborted) onAbort();
        else abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killTimer !== undefined) clearTimeout(killTimer);
        if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
        // A clean exit code after a timeout/abort SIGTERM must NOT count as
        // success — otherwise a truncated review is accepted as valid.
        const success = code === 0 && !timedOut && !aborted;
        resolve({
          success,
          rawOutput: Buffer.concat(stdoutChunks).toString("utf-8"),
          durationMs: now() - started,
          error: success
            ? undefined
            : timedOut
              ? `gemini timed out after ${timeoutMs}ms`
              : aborted
                ? "gemini aborted by caller"
                : Buffer.concat(stderrChunks).toString("utf-8").trim() ||
                  `gemini exit ${code ?? `signal ${signal ?? "unknown"}`}`,
        });
      });

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killTimer !== undefined) clearTimeout(killTimer);
        if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
        resolve({
          success: false,
          rawOutput: "",
          durationMs: now() - started,
          error: err.message,
        });
      });
    });
  }
}
