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

export interface ModelRunner {
  readonly name: string;
  runReview(prompt: string, workingDir: string, signal?: AbortSignal): Promise<ModelRunResult>;
  runGenerate(prompt: string, workingDir: string, signal?: AbortSignal): Promise<ModelRunResult>;
}
