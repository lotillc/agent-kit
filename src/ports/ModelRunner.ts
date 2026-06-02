/**
 * Strategy interface for agent model backends.
 *
 * Implementations (ClaudeRunner, CodexRunner, GeminiRunner, future OllamaRunner)
 * live under adapters/agent-cli/<vendor>/. Consensus logic in domain/review/ runs
 * N runners in parallel and aggregates by finding similarity.
 *
 * Scaffolding only in PR 1; concrete implementations arrive in PR 2 and PR 6.
 */
export interface ModelRunResult {
  success: boolean;
  rawOutput: string;
  costUsd?: number;
  durationMs: number;
  error?: string;
  // HTTP-ish status from the underlying provider error, when known. The breaker
  // reads this to classify retryability (4xx = non-retryable, don't trip; 429 = retry).
  errorStatusCode?: number;
  // Token usage, when the backend reports it (e.g. Claude CLI run stats). Lets
  // cost listeners attribute real token counts instead of zeros.
  tokens?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
}

// Per-call correlation copied verbatim onto every `CostEvent` the call emits
// (incl. breaker retries). Distinct from the ambient `RunContext`: metadata, not deps.
export interface RunCostContext {
  /** Stable id linking this call to a unit of work (e.g. an incident id). */
  readonly correlationId?: string;
  /** Arbitrary string tags copied onto the emitted `CostEvent`. */
  readonly tags?: Readonly<Record<string, string>>;
}

export interface ModelRunner {
  readonly name: string;
  runReview(
    prompt: string,
    workingDir: string,
    signal?: AbortSignal,
    context?: RunCostContext,
  ): Promise<ModelRunResult>;
  runGenerate(
    prompt: string,
    workingDir: string,
    signal?: AbortSignal,
    context?: RunCostContext,
  ): Promise<ModelRunResult>;
}
