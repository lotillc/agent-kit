import { withCostTracking } from "../aspects/withCostTracking.js";
import { createCostBudget } from "../domain/pipeline/budget.js";
import type { Logger } from "../ports/Logger.js";
import type { ModelRunner } from "../ports/ModelRunner.js";
import { type BreakerOptions, withBreaker } from "./breaker.js";
import type { CostListener, Provider, RunnerSpec } from "./RunnerSpec.js";

type ProviderFactory = (
  name: string,
  spec: RunnerSpec,
  onCost: CostListener | undefined,
  logger: Logger | undefined,
) => ModelRunner;

export interface CreateRunnerOptions {
  readonly onCost?: CostListener;
  readonly logger?: Logger;
}

export const createRunner = (
  name: string,
  spec: RunnerSpec,
  options: CreateRunnerOptions = {},
): ModelRunner => {
  // Aspect stack bottom-up: base -> breaker (timeout + retry + circuit) -> costTracking.
  // Retry lives inside the breaker chain so it can't re-invoke an open circuit.
  let runner = createBaseRunner(name, spec, options.onCost, options.logger);

  runner = withBreaker({
    runner,
    provider: spec.provider,
    baseUrl: spec.baseUrl,
    options: resolveBreakerOptions(spec),
    logger: options.logger,
    // claude-cli runs are long-lived agentic sessions; don't abort them on the
    // breaker's per-attempt timeout — only caller cancellation should stop them.
    passCooperativeTimeoutSignal: spec.provider !== "claude-cli",
  });

  if (spec.costBudgetUsd !== undefined) {
    runner = withCostTracking(runner, {
      budget: createCostBudget({ limitUsd: spec.costBudgetUsd }),
    });
  }
  return runner;
};

// `spec.breaker.maxRetries` (explicit) wins over the ergonomic `spec.maxRetries`.
const resolveBreakerOptions = (spec: RunnerSpec): BreakerOptions | undefined => {
  if (spec.maxRetries === undefined) return spec.breaker;
  return { maxRetries: spec.maxRetries, ...spec.breaker };
};

// Lazy base runner: dynamic-imports the provider adapter on first invocation so
// consumers that only use `claude-cli` don't pay for the `ai`/`@ai-sdk/*` optional
// peer deps. The resolved runner is cached after the first call.
const createBaseRunner = (
  name: string,
  spec: RunnerSpec,
  onCost: CostListener | undefined,
  logger: Logger | undefined,
): ModelRunner => {
  let resolved: Promise<ModelRunner> | undefined;
  const resolve = (): Promise<ModelRunner> => {
    if (!resolved) {
      resolved = loadProviderFactory(spec.provider).then((factory) =>
        factory(name, spec, onCost, logger),
      );
    }
    return resolved;
  };
  return {
    name,
    runReview: async (prompt, workingDir, signal, context) =>
      (await resolve()).runReview(prompt, workingDir, signal, context),
    runGenerate: async (prompt, workingDir, signal, context) =>
      (await resolve()).runGenerate(prompt, workingDir, signal, context),
  };
};

const loadProviderFactory = async (provider: Provider): Promise<ProviderFactory> => {
  switch (provider) {
    case "anthropic":
      return (await import("./providers/anthropic.js")).createAnthropicRunner;
    case "openai":
      return (await import("./providers/openai.js")).createOpenAiRunner;
    case "ollama":
      return (await import("./providers/ollama.js")).createOllamaRunner;
    case "claude-cli":
      return (await import("./providers/claudeCli.js")).createClaudeCliRunner;
  }
};
