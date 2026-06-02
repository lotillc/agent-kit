import { describe, expect, test, vi } from "vitest";

import { AbortedError, type CoverageAgentBag, DryRunError, NoWorkError } from "../pipeline/bag.js";
import { type PipelineStep, runSteps } from "../pipeline/runSteps.js";

// Minimal stub config — the sequencer never inspects fields, only threads it
// through. Concrete shape doesn't matter for these tests.
const STUB_CONFIG = {
  workingTree: "/tmp/wt",
  repoRoot: "/tmp/wt",
} as unknown as CoverageAgentBag["config"];

function step(
  name: string,
  impl: (bag: CoverageAgentBag) => Partial<CoverageAgentBag> | Promise<Partial<CoverageAgentBag>>,
): PipelineStep<CoverageAgentBag> {
  return { name, run: impl };
}

describe("runSteps", () => {
  test("returns the initial bag untouched for an empty step list", async () => {
    const initial: CoverageAgentBag = { config: STUB_CONFIG };
    const result = await runSteps([], initial);
    expect(result).toBe(initial);
  });

  test("awaits each step in order and merges partial outputs", async () => {
    const order: string[] = [];
    const steps: ReadonlyArray<PipelineStep<CoverageAgentBag>> = [
      step("a", () => {
        order.push("a");
        return {};
      }),
      step("b", async () => {
        order.push("b");
        return { prUrl: "https://github.com/x/y/pull/1" };
      }),
      step("c", (bag) => {
        order.push("c");
        // Output from previous step is visible on the bag.
        expect(bag.prUrl).toBe("https://github.com/x/y/pull/1");
        return {};
      }),
    ];
    const out = await runSteps(steps, { config: STUB_CONFIG });
    expect(order).toEqual(["a", "b", "c"]);
    expect(out.prUrl).toBe("https://github.com/x/y/pull/1");
  });

  test("invokes the log callback with each step name before running it", async () => {
    const log = vi.fn();
    const steps = [step("one", () => ({})), step("two", () => ({}))];
    await runSteps(steps, { config: STUB_CONFIG }, { log });
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenNthCalledWith(1, "one");
    expect(log).toHaveBeenNthCalledWith(2, "two");
  });

  test("invokes onStepComplete with the merged bag after each successful step", async () => {
    const seen: Array<Partial<CoverageAgentBag>> = [];
    const steps: ReadonlyArray<PipelineStep<CoverageAgentBag>> = [
      step("a", () => ({ prUrl: "https://github.com/x/y/pull/1" })),
      step("b", () => ({})),
    ];
    await runSteps(steps, { config: STUB_CONFIG }, { onStepComplete: (bag) => seen.push(bag) });
    expect(seen).toHaveLength(2);
    expect(seen[0]?.prUrl).toBe("https://github.com/x/y/pull/1");
    expect(seen[1]?.prUrl).toBe("https://github.com/x/y/pull/1");
  });

  test("does not invoke onStepComplete for a step that throws", async () => {
    const onStepComplete = vi.fn();
    const steps = [
      step("ok", () => ({})),
      step("boom", () => {
        throw new NoWorkError();
      }),
    ];
    await expect(
      runSteps(steps, { config: STUB_CONFIG }, { onStepComplete }),
    ).rejects.toBeInstanceOf(NoWorkError);
    // First step completes and fires the callback; second throws so no fire.
    expect(onStepComplete).toHaveBeenCalledTimes(1);
  });

  test("propagates typed errors and stops execution", async () => {
    const after = vi.fn(() => ({}));
    const steps = [
      step("boom", () => {
        throw new NoWorkError();
      }),
      step("after", after),
    ];
    await expect(runSteps(steps, { config: STUB_CONFIG })).rejects.toBeInstanceOf(NoWorkError);
    expect(after).not.toHaveBeenCalled();
  });

  test("propagates generic errors too (outer shell only catches typed ones)", async () => {
    const steps = [
      step("boom", () => {
        throw new Error("something unexpected");
      }),
    ];
    await expect(runSteps(steps, { config: STUB_CONFIG })).rejects.toThrow("something unexpected");
  });
});

describe("typed pipeline errors", () => {
  test("NoWorkError has name NoWorkError", () => {
    expect(new NoWorkError().name).toBe("NoWorkError");
  });
  test("DryRunError has name DryRunError", () => {
    expect(new DryRunError().name).toBe("DryRunError");
  });
  test("AbortedError carries its phase", () => {
    const a = new AbortedError("quality", "x");
    expect(a.phase).toBe("quality");
    expect(a.name).toBe("AbortedError");
    const b = new AbortedError("baseline", "y");
    expect(b.phase).toBe("baseline");
  });
});
