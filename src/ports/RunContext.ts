import type { Clock } from "./Clock.js";
import type { Logger } from "./Logger.js";
import type { Metrics } from "./Metrics.js";
import type { SpawnFn } from "./SpawnFn.js";

/**
 * Carries the ambient dependencies a single agent run needs.
 *
 * Passed through every step and every adapter so nothing reaches for globals.
 * See ADR-0025 (multi-run isolation).
 */
export interface RunContext {
  readonly runId: string;
  readonly consumerName: string;
  readonly logger: Logger;
  readonly metrics: Metrics;
  readonly spawn: SpawnFn;
  readonly clock: Clock;
  readonly events: EventEmitter;
  readonly budget?: CostBudget;
}

/**
 * Typed event emitter for the toolkit's public event taxonomy.
 *
 * See ADR-0016 — all events past-tense; listeners opt in, producers don't care who listens.
 */
export interface EventEmitter {
  emit(event: ToolkitEvent): void;
  on<T extends ToolkitEvent["type"]>(
    type: T,
    listener: (event: Extract<ToolkitEvent, { type: T }>) => void,
  ): () => void;
}

export type ToolkitEvent =
  | { type: "phase.started"; runId: string; phase: string; at: number }
  | { type: "phase.completed"; runId: string; phase: string; at: number; durationMs: number }
  | { type: "phase.failed"; runId: string; phase: string; at: number; error: string }
  | { type: "claude.turn_started"; runId: string; turn: number; at: number }
  | { type: "claude.turn_completed"; runId: string; turn: number; at: number }
  | { type: "cost.recorded"; runId: string; at: number; costUsd: number; source: string }
  | { type: "cost.budget_exceeded"; runId: string; at: number; spentUsd: number; budgetUsd: number }
  | { type: "finding.detected"; runId: string; at: number; severity: string; file: string }
  | { type: "pr.opened"; runId: string; at: number; prUrl: string; prNumber: number }
  | { type: "worktree.created"; runId: string; at: number; path: string }
  | { type: "worktree.cleaned_up"; runId: string; at: number; path: string };

/**
 * Cost budget tracking. See ADR-0018.
 *
 * `spentUsd` is a snapshot accessor — it reflects state at the time of read,
 * not a live-reactive value. Listeners that need push updates should subscribe
 * to the `cost.recorded` and `cost.budget_exceeded` events on `RunContext`.
 */
export interface CostBudget {
  readonly limitUsd: number;
  readonly spentUsd: number;
  record(additionalUsd: number): void;
  isExceeded(): boolean;
}
