import { randomUUID } from "node:crypto";

import type { ArtifactStore } from "../../ports/ArtifactStore.js";
import type { CostBudget } from "../../ports/RunContext.js";
import { type PipelineState, PipelineStateSchema } from "./state.js";

const STATE_KEY = "state";

export interface PipelineOptions<TPhase extends string = string> {
  /** Where state + artifacts live. Pipeline writes to `<key>=state`. */
  store: ArtifactStore;
  /**
   * Optional cost gate. `isBudgetExceeded()` returns false when omitted. When
   * resuming with `initialState`, pass a FRESH budget — the constructor seeds it
   * with `initialState.totalCostUsd` so the cap accounts for pre-restart spend.
   * Reusing a budget that already has spend throws (it would be double-counted).
   */
  budget?: CostBudget;
  /** Resume from this state instead of minting a fresh `runId`. */
  initialState?: PipelineState;
  /** Phase execution order — required for `getNextPhase` / `getLastCompletedPhase`. */
  phaseOrder?: readonly TPhase[];
}

/**
 * Phase-gated pipeline orchestrator. Tracks per-phase status, accumulates cost
 * (forwarding to an optional `CostBudget`), and persists state via `ArtifactStore`.
 */
export class Pipeline<TPhase extends string = string> {
  private state: PipelineState;
  private readonly store: ArtifactStore;
  private readonly budget: CostBudget | undefined;
  private readonly phaseOrder: readonly TPhase[];

  constructor(opts: PipelineOptions<TPhase>) {
    this.store = opts.store;
    this.budget = opts.budget;
    this.phaseOrder = opts.phaseOrder ?? [];
    // Deep-clone initialState so callers retaining their parsed-state reference
    // don't see Pipeline's in-place mutations leaking out.
    this.state = opts.initialState
      ? structuredClone(opts.initialState)
      : PipelineStateSchema.parse({
          runId: randomUUID().slice(0, 12),
          startedAt: new Date().toISOString(),
        });
    // Resuming with prior spend: seed the budget so isBudgetExceeded() accounts
    // for cost accumulated before the restart, not just this process's spend.
    if (opts.initialState && this.budget && this.state.totalCostUsd > 0) {
      // A reused budget that already has spend would be double-counted; fail loud
      // rather than silently bypass the cap. Resume with a fresh CostBudget.
      if (this.budget.spentUsd > 0) {
        throw new Error(
          "Pipeline: resume budget must start at $0 (it is seeded from " +
            "initialState.totalCostUsd). Pass a fresh CostBudget when resuming.",
        );
      }
      this.budget.record(this.state.totalCostUsd);
    }
  }

  get runId(): string {
    return this.state.runId;
  }

  /** Deep-cloned snapshot — mutating it never touches internal state. Call the methods to mutate. */
  get currentState(): Readonly<PipelineState> {
    return structuredClone(this.state);
  }

  async startPhase(phase: TPhase): Promise<void> {
    this.state.phases[phase] = {
      status: "running",
      startedAt: new Date().toISOString(),
    };
    await this.saveState();
  }

  async completePhase(phase: TPhase, opts: { costUsd?: number } = {}): Promise<void> {
    const phaseState = this.requirePhaseState(phase, "completePhase");
    // Validate cost BEFORE mutating local state, independent of whether a budget
    // is attached — otherwise a bad value corrupts totalCostUsd / phaseState and
    // can fail the nonnegative schema on a later loadState.
    if (opts.costUsd !== undefined) {
      assertValidCost(opts.costUsd);
      this.budget?.record(opts.costUsd);
    }
    phaseState.status = "completed";
    phaseState.completedAt = new Date().toISOString();
    if (opts.costUsd !== undefined) {
      phaseState.costUsd = opts.costUsd;
      this.state.totalCostUsd = roundUsd(this.state.totalCostUsd + opts.costUsd);
    }
    await this.saveState();
  }

  async failPhase(phase: TPhase, error: string): Promise<void> {
    const phaseState = this.requirePhaseState(phase, "failPhase");
    phaseState.status = "failed";
    phaseState.completedAt = new Date().toISOString();
    phaseState.error = error;
    await this.saveState();
  }

  async skipPhase(phase: TPhase): Promise<void> {
    this.state.phases[phase] = {
      status: "skipped",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    await this.saveState();
  }

  isBudgetExceeded(): boolean {
    return this.budget?.isExceeded() ?? false;
  }

  isMaxIterationsReached(max: number): boolean {
    if (!Number.isInteger(max) || max < 0) {
      throw new TypeError(
        `Pipeline.isMaxIterationsReached: max must be a non-negative integer (got ${max})`,
      );
    }
    return this.state.iterationCount >= max;
  }

  async incrementIteration(): Promise<number> {
    this.state.iterationCount += 1;
    await this.saveState();
    return this.state.iterationCount;
  }

  setBranchName(branchName: string): void {
    this.state.branchName = branchName;
  }

  setPrNumber(prNumber: number): void {
    this.state.prNumber = prNumber;
  }

  setMetadata(key: string, value: unknown): void {
    this.state.metadata[key] = value;
  }

  getLastCompletedPhase(): TPhase | null {
    for (let i = this.phaseOrder.length - 1; i >= 0; i -= 1) {
      const phase = this.phaseOrder[i];
      if (phase && this.state.phases[phase]?.status === "completed") return phase;
    }
    return null;
  }

  getNextPhase(): TPhase | null {
    for (const phase of this.phaseOrder) {
      const status = this.state.phases[phase]?.status;
      // "running" is resumable too: after a crash/restart it has no live worker,
      // so it's the next phase to run — not something to skip past.
      if (!status || status === "pending" || status === "failed" || status === "running") {
        return phase;
      }
    }
    return null;
  }

  async saveState(): Promise<void> {
    await this.store.write(STATE_KEY, JSON.stringify(this.state, null, 2));
  }

  private requirePhaseState(phase: TPhase, op: string) {
    const phaseState = this.state.phases[phase];
    if (!phaseState) {
      // Surface the misuse — silently no-op'ing a transition for a never-started
      // phase masks bugs in the orchestrator.
      throw new Error(`Pipeline.${op}: phase "${phase}" was never started`);
    }
    return phaseState;
  }

  static async loadState(store: ArtifactStore): Promise<PipelineState | null> {
    const raw = await store.read(STATE_KEY);
    if (raw === null) return null;
    return PipelineStateSchema.parse(JSON.parse(raw));
  }
}

const roundUsd = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;

const assertValidCost = (costUsd: number): void => {
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    throw new TypeError(
      `Pipeline.completePhase: costUsd must be a non-negative finite number (got ${costUsd})`,
    );
  }
};
