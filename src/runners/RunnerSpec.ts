import type { ModelRunner, RunCostContext } from "../ports/ModelRunner.js";
import type { BreakerOptions } from "./breaker.js";
import type { SecretLike } from "./secret.js";

export type Provider = "anthropic" | "openai" | "ollama" | "claude-cli";

export interface RunnerSpec {
  readonly provider: Provider;
  readonly model: string;
  /**
   * Provider API key. `string` accepted for back-compat, but pass a `Secret`
   * to ensure accidental logging emits `[REDACTED]` instead of the key.
   */
  readonly apiKey?: SecretLike;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /**
   * Retries after the first failed attempt (so `2` = up to 3 attempts).
   * Runs inside the breaker chain so circuit-open responses are not retried.
   * `spec.breaker.maxRetries`, when set, overrides this value.
   */
  readonly maxRetries?: number;
  readonly costBudgetUsd?: number;
  /**
   * Per-provider circuit-breaker tuning. Omit to use the runners default
   * (5 consecutive failures opens the circuit for 30s). See `breaker.ts`.
   */
  readonly breaker?: BreakerOptions;
}

// `correlationId` / `tags` come from the call's `RunCostContext` (undefined when
// the caller passed none), letting consumers attribute spend to a unit of work.
export interface CostEvent extends RunCostContext {
  readonly runnerName: string;
  readonly provider: Provider;
  readonly model: string;
  readonly kind: "review" | "generate";
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly tokensSource: "provider" | "cli" | "unavailable";
  readonly costUsd: number;
  readonly durationMs: number;
  readonly at: number;
  readonly success: boolean;
}

export type CostListener = (event: CostEvent) => void;
export type Unsubscribe = () => void;

export interface RunnerRegistry {
  get(name: string): ModelRunner;
  onCost(listener: CostListener): Unsubscribe;
  names(): readonly string[];
}
