// Per-provider circuit breaker mirroring the cockatiel timeout/retry/breaker
// chain in `packages/shared/src/base-api-client.ts`. One breaker per
// `${provider}:${baseUrl}:${tuning}` tuple (see `policyKey`) so specs sharing
// tuning share a budget. `policyRegistry` is a process-lived bounded LRU
// (`MAX_POLICIES`) so dynamically-minted tuples can't grow it unboundedly.
import {
  ConsecutiveBreaker,
  circuitBreaker,
  ExponentialBackoff,
  handleWhen,
  type IPolicy,
  isBrokenCircuitError,
  retry,
  TimeoutStrategy,
  timeout,
  wrap,
} from "cockatiel";
import type { Logger } from "../ports/Logger.js";
import type { ModelRunner, ModelRunResult } from "../ports/ModelRunner.js";

export interface BreakerOptions {
  readonly perAttemptTimeoutMs?: number;
  readonly maxRetries?: number;
  readonly baseDelayMs?: number;
  readonly backoffMultiplier?: number;
  readonly breakerThreshold?: number;
  readonly breakerDurationMs?: number;
}

const DEFAULTS = {
  perAttemptTimeoutMs: 60_000,
  maxRetries: 0,
  baseDelayMs: 500,
  backoffMultiplier: 2.0,
  breakerThreshold: 5,
  breakerDurationMs: 30_000,
} as const;

export class RunnerCircuitOpenError extends Error {
  readonly runnerName: string;
  readonly provider: string;

  constructor(runnerName: string, provider: string, cause?: Error) {
    super(
      `Runner "${runnerName}" (${provider}) circuit is open — upstream is unhealthy, refusing call`,
      cause ? { cause } : undefined,
    );
    this.name = "RunnerCircuitOpenError";
    this.runnerName = runnerName;
    this.provider = provider;
  }
}

const policyRegistry = new Map<string, IPolicy>();

const policyKey = (
  provider: string,
  baseUrl: string | undefined,
  opts: BreakerOptions,
  applyTimeout: boolean,
): string =>
  [
    provider,
    baseUrl ?? "default",
    applyTimeout,
    opts.perAttemptTimeoutMs ?? DEFAULTS.perAttemptTimeoutMs,
    opts.maxRetries ?? DEFAULTS.maxRetries,
    opts.baseDelayMs ?? DEFAULTS.baseDelayMs,
    opts.backoffMultiplier ?? DEFAULTS.backoffMultiplier,
    opts.breakerThreshold ?? DEFAULTS.breakerThreshold,
    opts.breakerDurationMs ?? DEFAULTS.breakerDurationMs,
  ].join(":");

// Carries a base-runner failure result up through the cockatiel chain so the
// retry/breaker policies actually observe it (base runners return success:false
// rather than throwing). `cancelled` marks a caller-supplied cancellation (vs a
// breaker/own timeout) so it can be exempted. Unwrapped back into a result by `guard`.
class RunnerExecutionFailure extends Error {
  constructor(
    readonly result: ModelRunResult,
    readonly cancelled: boolean,
  ) {
    super(result.error ?? "runner call failed");
    this.name = "RunnerExecutionFailure";
  }
}

const statusOf = (err: unknown): number | undefined => {
  if (err instanceof RunnerExecutionFailure) return err.result.errorStatusCode;
  if (err && typeof err === "object") {
    const e = err as { statusCode?: number; status?: number };
    return e.statusCode ?? e.status;
  }
  return undefined;
};

const isNonRetryable = (err: unknown): boolean => {
  // A caller-supplied cancellation is the caller's decision — never retry it or
  // count it toward the circuit. A breaker/own timeout is NOT exempt: a slow
  // upstream should still trip the circuit (cancelled stays false for those).
  if (err instanceof RunnerExecutionFailure && err.cancelled) return true;
  // Defensive: a runner that THROWS a raw AbortError (rather than returning a
  // result) is treated as a cancellation. Today's runners always return results.
  if (err instanceof Error && err.name === "AbortError") return true;
  const status = statusOf(err);
  // 429 (rate limit) is transient: retry it and let it count toward the circuit.
  return typeof status === "number" && status >= 400 && status < 500 && status !== 429;
};

const buildPolicy = (opts: BreakerOptions, applyTimeout: boolean): IPolicy => {
  // Order outer -> inner: circuit -> retry -> timeout. Circuit outermost so an
  // open circuit short-circuits before retry runs; timeout innermost so it
  // bounds each individual attempt (not the whole retry sequence).
  const policies: IPolicy[] = [
    circuitBreaker(
      handleWhen((err) => !isNonRetryable(err)),
      {
        halfOpenAfter: opts.breakerDurationMs ?? DEFAULTS.breakerDurationMs,
        breaker: new ConsecutiveBreaker(opts.breakerThreshold ?? DEFAULTS.breakerThreshold),
      },
    ),
  ];

  const maxRetries = opts.maxRetries ?? DEFAULTS.maxRetries;
  if (maxRetries > 0) {
    policies.push(
      retry(
        handleWhen((err) => !isNonRetryable(err)),
        {
          maxAttempts: maxRetries,
          backoff: new ExponentialBackoff({
            initialDelay: opts.baseDelayMs ?? DEFAULTS.baseDelayMs,
            exponent: opts.backoffMultiplier ?? DEFAULTS.backoffMultiplier,
          }),
        },
      ),
    );
  }

  // Omit the timeout when the runner won't observe its cooperative signal
  // (claude-cli). A cooperative timeout whose signal is ignored fires its timer
  // and then waits forever for the callee — so for those runners we apply no
  // per-attempt timeout at all; they're bounded by their own request timeout.
  if (applyTimeout) {
    policies.push(
      timeout(
        opts.perAttemptTimeoutMs ?? DEFAULTS.perAttemptTimeoutMs,
        TimeoutStrategy.Cooperative,
      ),
    );
  }

  return policies.length === 1 ? policies[0]! : wrap(...(policies as [IPolicy, IPolicy]));
};

const MAX_POLICIES = 256;

const getPolicy = (
  provider: string,
  baseUrl: string | undefined,
  opts: BreakerOptions,
  applyTimeout: boolean,
): IPolicy => {
  const key = policyKey(provider, baseUrl, opts, applyTimeout);
  const existing = policyRegistry.get(key);
  if (existing) {
    // Refresh LRU recency so hot breakers aren't the ones evicted.
    policyRegistry.delete(key);
    policyRegistry.set(key, existing);
    return existing;
  }
  const policy = buildPolicy(opts, applyTimeout);
  // Bounded LRU: drop the least-recently-used entry so a process minting many
  // distinct (provider, baseUrl, tuning) tuples can't grow the map forever.
  if (policyRegistry.size >= MAX_POLICIES) {
    const oldest = policyRegistry.keys().next().value;
    if (oldest !== undefined) policyRegistry.delete(oldest);
  }
  policyRegistry.set(key, policy);
  return policy;
};

/** Test-only: reset shared breaker state between test cases. */
export const __resetBreakerRegistryForTesting = (): void => {
  policyRegistry.clear();
};

export interface WithBreakerInput {
  readonly runner: ModelRunner;
  readonly provider: string;
  readonly baseUrl?: string;
  readonly options?: BreakerOptions;
  readonly logger?: Logger;
  /**
   * Whether the runner observes the breaker's cooperative per-attempt timeout
   * (default true). Set false for long-lived runners (claude-cli) so an agentic
   * run isn't aborted by the per-attempt default — they get only caller cancellation.
   */
  readonly passCooperativeTimeoutSignal?: boolean;
}

export const withBreaker = ({
  runner,
  provider,
  baseUrl,
  options = {},
  logger,
  passCooperativeTimeoutSignal = true,
}: WithBreakerInput): ModelRunner => {
  const policy = getPolicy(provider, baseUrl, options, passCooperativeTimeoutSignal);

  const guard = async (
    invoke: (signal: AbortSignal | undefined) => Promise<ModelRunResult>,
    parentSignal: AbortSignal | undefined,
  ): Promise<ModelRunResult> => {
    // Sum costUsd across every attempt (including failed/retried ones) so the
    // returned result reflects the logical call's total spend — otherwise a
    // downstream cost budget would only see the final attempt and undercount retries.
    let spentUsd = 0;
    const withTotalCost = (result: ModelRunResult): ModelRunResult =>
      spentUsd > 0 ? { ...result, costUsd: spentUsd } : result;
    try {
      // A success:false result is re-thrown inside the policy so retry/breaker
      // observe it, then unwrapped below — base runners never throw on their own.
      // parentSignal.aborted distinguishes a caller cancellation (exempt) from a
      // breaker/own timeout (which only aborts cockatiel's signal, not parentSignal).
      const result = await policy.execute(async ({ signal }) => {
        // Long-lived runners get only the caller's signal, not the per-attempt
        // cooperative timeout (which would otherwise abort the in-flight call).
        const runnerSignal = passCooperativeTimeoutSignal ? signal : parentSignal;
        const attempt = await invoke(runnerSignal);
        if (typeof attempt.costUsd === "number") spentUsd += attempt.costUsd;
        if (!attempt.success) {
          throw new RunnerExecutionFailure(attempt, parentSignal?.aborted === true);
        }
        return attempt;
      }, parentSignal);
      return withTotalCost(result);
    } catch (err) {
      if (err instanceof RunnerExecutionFailure) return withTotalCost(err.result);
      if (isBrokenCircuitError(err)) {
        logger?.warn("runner.circuit_open", { runner: runner.name, provider });
        return {
          success: false,
          rawOutput: "",
          durationMs: 0,
          error: new RunnerCircuitOpenError(runner.name, provider, err as Error).message,
        };
      }
      throw err;
    }
  };

  return {
    name: runner.name,
    runReview: (prompt, workingDir, signal, context) =>
      guard((s) => runner.runReview(prompt, workingDir, s, context), signal),
    runGenerate: (prompt, workingDir, signal, context) =>
      guard((s) => runner.runGenerate(prompt, workingDir, s, context), signal),
  };
};
