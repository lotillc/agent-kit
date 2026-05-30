import type { Logger } from "../ports/Logger.js";
import type { ModelRunner } from "../ports/ModelRunner.js";
import { safeCallCostListener } from "./costListener.js";
import { createRunner as defaultCreateRunner } from "./createRunner.js";
import type {
  CostEvent,
  CostListener,
  RunnerRegistry,
  RunnerSpec,
  Unsubscribe,
} from "./RunnerSpec.js";

export interface CreateRunnerRegistryOptions {
  readonly logger?: Logger;
  readonly createRunner?: (
    name: string,
    spec: RunnerSpec,
    options: { onCost?: CostListener; logger?: Logger },
  ) => ModelRunner;
}

export const createRunnerRegistry = (
  specs: Readonly<Record<string, RunnerSpec>>,
  { createRunner = defaultCreateRunner, logger }: CreateRunnerRegistryOptions = {},
): RunnerRegistry => {
  const listeners = new Set<CostListener>();
  // Snapshot before iterating: subscribes/unsubscribes during dispatch take
  // effect from the next event, never mid-fan-out.
  const broadcast: CostListener = (event: CostEvent) => {
    const snapshot = [...listeners];
    for (const listener of snapshot) safeCallCostListener(listener, event, logger);
  };

  const runners = new Map<string, ModelRunner>();
  for (const [name, spec] of Object.entries(specs)) {
    runners.set(name, createRunner(name, spec, { onCost: broadcast, logger }));
  }

  return {
    get(name: string): ModelRunner {
      const runner = runners.get(name);
      if (!runner) {
        throw new Error(
          `Unknown runner "${name}". Available: ${[...runners.keys()].join(", ") || "(none)"}`,
        );
      }
      return runner;
    },
    onCost(listener: CostListener): Unsubscribe {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    names(): readonly string[] {
      return [...runners.keys()];
    },
  };
};
