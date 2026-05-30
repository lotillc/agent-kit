import type { Logger } from "../ports/Logger.js";
import type { CostEvent, CostListener } from "./RunnerSpec.js";

// Invoke a CostListener without letting a thrown listener bubble into the
// emitting runner (which would corrupt its result) or starve other listeners.
export const safeCallCostListener = (
  listener: CostListener | undefined,
  event: CostEvent,
  logger?: Logger,
): void => {
  if (!listener) return;
  try {
    listener(event);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logger) {
      logger.error("runner.cost_listener_threw", {
        runnerName: event.runnerName,
        provider: event.provider,
        model: event.model,
        error: msg,
      });
      return;
    }
    // eslint-disable-next-line no-console
    console.warn("[agent-kit] cost listener threw:", {
      runnerName: event.runnerName,
      error: msg,
    });
  }
};
