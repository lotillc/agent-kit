import type { ModelRunner, ModelRunResult } from "../ports/ModelRunner.js";
import type { CostBudget } from "../ports/RunContext.js";

/**
 * AOP aspect: wrap a `ModelRunner` so every call records cost against a
 * `CostBudget`. When the budget is exceeded, subsequent invocations short-
 * circuit with a failure result (no spawn) instead of letting the runner
 * silently keep spending.
 *
 * Use alongside `withRetry`, `withTimeout`, `withLogging` — stack the aspects
 * bottom-up (aspects closer to the runner execute first). See ADR-0039.
 */
export interface WithCostTrackingOptions {
  budget: CostBudget;
  /**
   * Fired after each runner call that reported a `costUsd`. The aspect itself
   * has no access to `RunContext.events` (kept dependency-free), so callers wire
   * this to `ctx.events.emit({ type: "cost.recorded", ... })` if they want to
   * fan out the toolkit event taxonomy.
   */
  onCostRecorded?: (costUsd: number) => void;
  /**
   * Called when the budget is exceeded mid-run. Wire to a
   * `cost.budget_exceeded` event on `RunContext.events`.
   */
  onBudgetExceeded?: (spentUsd: number, limitUsd: number) => void;
}

export const withCostTracking = (
  runner: ModelRunner,
  { budget, onCostRecorded, onBudgetExceeded }: WithCostTrackingOptions,
): ModelRunner => ({
  name: runner.name,
  runReview: async (prompt, workingDir, signal) => {
    if (budget.isExceeded()) {
      return budgetExceededResult(budget);
    }
    const result = await runner.runReview(prompt, workingDir, signal);
    recordIfPresent(result, budget, onCostRecorded, onBudgetExceeded);
    return result;
  },
  runGenerate: async (prompt, workingDir, signal) => {
    if (budget.isExceeded()) {
      return budgetExceededResult(budget);
    }
    const result = await runner.runGenerate(prompt, workingDir, signal);
    recordIfPresent(result, budget, onCostRecorded, onBudgetExceeded);
    return result;
  },
});

const recordIfPresent = (
  result: ModelRunResult,
  budget: CostBudget,
  onCostRecorded?: (costUsd: number) => void,
  onBudgetExceeded?: (spentUsd: number, limitUsd: number) => void,
): void => {
  if (typeof result.costUsd !== "number") return;
  budget.record(result.costUsd);
  onCostRecorded?.(result.costUsd);
  if (budget.isExceeded()) {
    onBudgetExceeded?.(budget.spentUsd, budget.limitUsd);
  }
};

const budgetExceededResult = (budget: CostBudget): ModelRunResult => ({
  success: false,
  rawOutput: "",
  durationMs: 0,
  error: `cost budget exceeded: $${budget.spentUsd.toFixed(4)} ≥ $${budget.limitUsd.toFixed(4)}`,
});
