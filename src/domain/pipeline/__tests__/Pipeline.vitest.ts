import { describe, expect, test } from "vitest";

import type { ArtifactStore } from "../../../ports/ArtifactStore.js";
import { createCostBudget } from "../budget.js";
import { Pipeline } from "../Pipeline.js";
import { PipelineStateSchema } from "../state.js";

type Phase = "plan" | "spec" | "implement" | "review";
const PHASE_ORDER: readonly Phase[] = ["plan", "spec", "implement", "review"];

class InMemoryStore implements ArtifactStore {
  private readonly entries = new Map<string, string>();
  async read(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }
  async write(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
  }
  async exists(key: string): Promise<boolean> {
    return this.entries.has(key);
  }
  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

describe("Pipeline", () => {
  test("fresh pipeline mints a runId and persists state", async () => {
    const store = new InMemoryStore();
    const p = new Pipeline({ store });
    await p.saveState();
    const loaded = await Pipeline.loadState(store);
    expect(loaded).not.toBeNull();
    expect(loaded?.runId).toBe(p.runId);
    expect(loaded?.iterationCount).toBe(0);
    expect(loaded?.totalCostUsd).toBe(0);
  });

  test("phase transitions: start -> complete writes status + cost + timestamps", async () => {
    const store = new InMemoryStore();
    const p = new Pipeline<Phase>({ store, phaseOrder: PHASE_ORDER });
    await p.startPhase("plan");
    expect(p.currentState.phases.plan?.status).toBe("running");
    expect(p.currentState.phases.plan?.startedAt).toBeTypeOf("string");
    await p.completePhase("plan", { costUsd: 0.25 });
    expect(p.currentState.phases.plan?.status).toBe("completed");
    expect(p.currentState.phases.plan?.completedAt).toBeTypeOf("string");
    expect(p.currentState.phases.plan?.costUsd).toBe(0.25);
    expect(p.currentState.totalCostUsd).toBe(0.25);
  });

  test("currentState returns a snapshot — mutating it does not affect internal state", async () => {
    const store = new InMemoryStore();
    const p = new Pipeline<Phase>({ store, phaseOrder: PHASE_ORDER });
    await p.startPhase("plan");
    const snapshot = p.currentState as unknown as {
      phases: Record<string, { status: string } | undefined>;
      metadata: Record<string, unknown>;
    };
    if (snapshot.phases.plan) snapshot.phases.plan.status = "completed";
    snapshot.metadata.injected = true;
    expect(p.currentState.phases.plan?.status).toBe("running");
    expect(p.currentState.metadata.injected).toBeUndefined();
  });

  test("failPhase records status + error message", async () => {
    const store = new InMemoryStore();
    const p = new Pipeline<Phase>({ store });
    await p.startPhase("plan");
    await p.failPhase("plan", "claude crashed");
    expect(p.currentState.phases.plan?.status).toBe("failed");
    expect(p.currentState.phases.plan?.error).toBe("claude crashed");
  });

  test("skipPhase records status without start", async () => {
    const store = new InMemoryStore();
    const p = new Pipeline<Phase>({ store });
    await p.skipPhase("review");
    expect(p.currentState.phases.review?.status).toBe("skipped");
    expect(p.currentState.phases.review?.startedAt).toBeTypeOf("string");
    expect(p.currentState.phases.review?.completedAt).toBeTypeOf("string");
  });

  test("cumulative cost rounds at micro-USD to absorb IEEE-754 drift", async () => {
    const store = new InMemoryStore();
    const p = new Pipeline<Phase>({ store });
    await p.startPhase("plan");
    await p.completePhase("plan", { costUsd: 0.1 });
    await p.startPhase("spec");
    await p.completePhase("spec", { costUsd: 0.2 });
    expect(p.currentState.totalCostUsd).toBe(0.3);
  });

  test("forwards cost to provided CostBudget and isBudgetExceeded flips", async () => {
    const store = new InMemoryStore();
    const budget = createCostBudget({ limitUsd: 1.0 });
    const p = new Pipeline<Phase>({ store, budget });
    await p.startPhase("plan");
    await p.completePhase("plan", { costUsd: 0.5 });
    expect(p.isBudgetExceeded()).toBe(false);
    await p.startPhase("spec");
    await p.completePhase("spec", { costUsd: 0.6 });
    expect(p.isBudgetExceeded()).toBe(true);
    expect(budget.spentUsd).toBeCloseTo(1.1, 6);
  });

  test("isBudgetExceeded is false when no budget is provided", async () => {
    const store = new InMemoryStore();
    const p = new Pipeline<Phase>({ store });
    await p.startPhase("plan");
    await p.completePhase("plan", { costUsd: 1000 });
    expect(p.isBudgetExceeded()).toBe(false);
  });

  test("incrementIteration counts up; isMaxIterationsReached respects the cap", async () => {
    const store = new InMemoryStore();
    const p = new Pipeline<Phase>({ store });
    expect(p.isMaxIterationsReached(3)).toBe(false);
    expect(await p.incrementIteration()).toBe(1);
    expect(await p.incrementIteration()).toBe(2);
    expect(p.isMaxIterationsReached(3)).toBe(false);
    expect(await p.incrementIteration()).toBe(3);
    expect(p.isMaxIterationsReached(3)).toBe(true);
    // Crash-resilient: each increment is persisted, so a resume after a crash
    // mid-iteration loop sees the bumped counter.
    const loaded = await Pipeline.loadState(store);
    expect(loaded?.iterationCount).toBe(3);
  });

  test("isMaxIterationsReached rejects non-integer / negative cap", async () => {
    const store = new InMemoryStore();
    const p = new Pipeline<Phase>({ store });
    expect(() => p.isMaxIterationsReached(1.5)).toThrow(TypeError);
    expect(() => p.isMaxIterationsReached(-1)).toThrow(TypeError);
  });

  test("getNextPhase / getLastCompletedPhase respect phaseOrder", async () => {
    const store = new InMemoryStore();
    const p = new Pipeline<Phase>({ store, phaseOrder: PHASE_ORDER });
    expect(p.getNextPhase()).toBe("plan");
    expect(p.getLastCompletedPhase()).toBeNull();
    await p.startPhase("plan");
    await p.completePhase("plan");
    expect(p.getLastCompletedPhase()).toBe("plan");
    expect(p.getNextPhase()).toBe("spec");
    await p.startPhase("spec");
    await p.failPhase("spec", "x");
    // Failed phase is a valid resume point — surfaces as the next-to-run.
    expect(p.getNextPhase()).toBe("spec");
  });

  test("getNextPhase resumes a phase left running by a crash", async () => {
    const store = new InMemoryStore();
    const first = new Pipeline<Phase>({ store, phaseOrder: PHASE_ORDER });
    await first.startPhase("plan"); // persisted as "running", then the process dies
    const persisted = await Pipeline.loadState(store);
    const resumed = new Pipeline<Phase>({
      store,
      phaseOrder: PHASE_ORDER,
      initialState: persisted!,
    });
    // The orphaned running phase is the next to run, not skipped.
    expect(resumed.getNextPhase()).toBe("plan");
  });

  test("getNextPhase returns null without phaseOrder configured", async () => {
    const store = new InMemoryStore();
    const p = new Pipeline<Phase>({ store });
    expect(p.getNextPhase()).toBeNull();
    expect(p.getLastCompletedPhase()).toBeNull();
  });

  test("setBranchName / setPrNumber / setMetadata land in state", async () => {
    const store = new InMemoryStore();
    const p = new Pipeline<Phase>({ store });
    p.setBranchName("feat/x");
    p.setPrNumber(42);
    p.setMetadata("requirements", "rate-limit the API");
    await p.saveState();
    const loaded = await Pipeline.loadState(store);
    expect(loaded?.branchName).toBe("feat/x");
    expect(loaded?.prNumber).toBe(42);
    expect(loaded?.metadata.requirements).toBe("rate-limit the API");
  });

  test("loadState returns null when no state has been persisted", async () => {
    const store = new InMemoryStore();
    expect(await Pipeline.loadState(store)).toBeNull();
  });

  test("completePhase / failPhase throw when phase was never started", async () => {
    const store = new InMemoryStore();
    const p = new Pipeline<Phase>({ store });
    await expect(p.completePhase("plan")).rejects.toThrow(/never started/);
    await expect(p.failPhase("plan", "boom")).rejects.toThrow(/never started/);
  });

  test("completePhase with no costUsd leaves totalCostUsd at 0", async () => {
    const store = new InMemoryStore();
    const p = new Pipeline<Phase>({ store });
    await p.startPhase("plan");
    await p.completePhase("plan");
    expect(p.currentState.phases.plan?.status).toBe("completed");
    expect(p.currentState.phases.plan?.costUsd).toBeUndefined();
    expect(p.currentState.totalCostUsd).toBe(0);
  });

  test("budget.record throwing prevents state.totalCostUsd from being inflated", async () => {
    const store = new InMemoryStore();
    const budget = createCostBudget({ limitUsd: 10 });
    const p = new Pipeline<Phase>({ store, budget });
    await p.startPhase("plan");
    // Negative cost — budget.record rejects synchronously. State must stay at 0.
    await expect(p.completePhase("plan", { costUsd: -1 })).rejects.toThrow(TypeError);
    expect(p.currentState.totalCostUsd).toBe(0);
    expect(p.currentState.phases.plan?.status).toBe("running");
    expect(budget.spentUsd).toBe(0);
  });

  test("setMetadata overwrites the value on the same key", async () => {
    const store = new InMemoryStore();
    const p = new Pipeline<Phase>({ store });
    p.setMetadata("requirements", "first");
    p.setMetadata("requirements", "second");
    expect(p.currentState.metadata.requirements).toBe("second");
  });

  test("initialState is deep-cloned so caller's reference is not mutated", async () => {
    const store = new InMemoryStore();
    const seed = PipelineStateSchema.parse({
      runId: "abc",
      startedAt: new Date().toISOString(),
    });
    const p = new Pipeline<Phase>({ store, initialState: seed, phaseOrder: PHASE_ORDER });
    await p.startPhase("plan");
    // The caller's seed should NOT see the new phase entry.
    expect(seed.phases.plan).toBeUndefined();
    expect(p.currentState.phases.plan?.status).toBe("running");
  });

  test("initialState restores a prior run without minting a new runId", async () => {
    const store = new InMemoryStore();
    const first = new Pipeline<Phase>({ store, phaseOrder: PHASE_ORDER });
    await first.startPhase("plan");
    await first.completePhase("plan", { costUsd: 0.5 });
    const persisted = await Pipeline.loadState(store);
    expect(persisted).not.toBeNull();
    const resumed = new Pipeline<Phase>({
      store,
      phaseOrder: PHASE_ORDER,
      initialState: persisted!,
    });
    expect(resumed.runId).toBe(first.runId);
    expect(resumed.getLastCompletedPhase()).toBe("plan");
    expect(resumed.currentState.totalCostUsd).toBe(0.5);
  });

  test("completePhase rejects a negative / non-finite cost even without a budget", async () => {
    const store = new InMemoryStore();
    const p = new Pipeline<Phase>({ store }); // no budget attached
    await p.startPhase("plan");
    await expect(p.completePhase("plan", { costUsd: -1 })).rejects.toThrow(TypeError);
    await expect(p.completePhase("plan", { costUsd: Number.NaN })).rejects.toThrow(TypeError);
    // State stays clean — no inflation, phase still running.
    expect(p.currentState.totalCostUsd).toBe(0);
    expect(p.currentState.phases.plan?.status).toBe("running");
  });

  test("resuming with prior spend seeds the budget so the cap still binds", async () => {
    const store = new InMemoryStore();
    const seed = PipelineStateSchema.parse({
      runId: "resumed",
      startedAt: new Date().toISOString(),
      totalCostUsd: 0.9,
    });
    const budget = createCostBudget({ limitUsd: 1.0 });
    const resumed = new Pipeline<Phase>({ store, budget, initialState: seed });
    // Budget reflects the 0.9 already spent before the restart, not $0.
    expect(budget.spentUsd).toBeCloseTo(0.9, 6);
    expect(resumed.isBudgetExceeded()).toBe(false);
    await resumed.startPhase("plan");
    await resumed.completePhase("plan", { costUsd: 0.2 }); // 0.9 + 0.2 = 1.1 > 1.0
    expect(resumed.isBudgetExceeded()).toBe(true);
  });

  test("resuming with a budget that already has spend throws (would double-count)", () => {
    const store = new InMemoryStore();
    const seed = PipelineStateSchema.parse({
      runId: "r",
      startedAt: new Date().toISOString(),
      totalCostUsd: 0.5,
    });
    const budget = createCostBudget({ limitUsd: 1.0 });
    budget.record(0.3); // reused budget already carries spend
    expect(() => new Pipeline<Phase>({ store, budget, initialState: seed })).toThrow(
      /fresh CostBudget/,
    );
  });
});
