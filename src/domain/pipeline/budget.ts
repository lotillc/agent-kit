import type { CostBudget } from "../../ports/RunContext.js";

/**
 * Pure CostBudget implementation. Holds an in-memory spend counter; does not
 * emit events itself (event emission is the caller's concern — see
 * `RunContext.events`).
 *
 * Matches the port contract in `ports/RunContext.ts`. `spentUsd` is a snapshot
 * accessor per ADR-0018.
 */
export interface CreateCostBudgetInput {
  limitUsd: number;
}

export const createCostBudget = ({ limitUsd }: CreateCostBudgetInput): CostBudget => {
  if (!Number.isFinite(limitUsd) || limitUsd < 0) {
    throw new TypeError(
      `CostBudget.limitUsd must be a non-negative finite number (got ${limitUsd})`,
    );
  }
  let spent = 0;
  return {
    limitUsd,
    get spentUsd() {
      return spent;
    },
    record(additionalUsd: number): void {
      if (!Number.isFinite(additionalUsd) || additionalUsd < 0) {
        throw new TypeError(
          `CostBudget.record: additional must be a non-negative finite number (got ${additionalUsd})`,
        );
      }
      // Round to micro-dollar precision after each accumulation. IEEE-754 drift
      // (e.g. 0.1 + 0.2 = 0.30000000000000004) otherwise causes isExceeded() to
      // trip a budget that has not actually been exceeded — Claude bills at
      // 4-decimal-USD precision, so 6 decimals leaves headroom.
      spent = Math.round((spent + additionalUsd) * 1_000_000) / 1_000_000;
    },
    isExceeded(): boolean {
      return spent > limitUsd;
    },
  };
};
