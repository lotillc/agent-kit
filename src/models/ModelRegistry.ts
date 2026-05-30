import type { ModelRunner } from "../ports/ModelRunner.js";

/**
 * Runtime registry for `ModelRunner` implementations.
 *
 * Enables the multi-model consensus in `domain/review/consensus.ts` to fan out over a
 * configurable set of runners without hard-coding Claude/Codex/Gemini.
 */
export class ModelRegistry {
  private readonly runners = new Map<string, ModelRunner>();

  register(runner: ModelRunner): void {
    this.runners.set(runner.name, runner);
  }

  get(name: string): ModelRunner | undefined {
    return this.runners.get(name);
  }

  /**
   * Strict lookup — throws `MissingRunnerError` when the runner has not been
   * registered (ADR-0041: fail-fast). Consumers that want graceful degradation
   * should `.get()` + handle `undefined`.
   */
  getOrThrow(name: string): ModelRunner {
    const runner = this.runners.get(name);
    if (!runner) throw new MissingRunnerError(name);
    return runner;
  }

  all(): ModelRunner[] {
    return [...this.runners.values()];
  }

  getMany(names: ReadonlyArray<string>): ModelRunner[] {
    const out: ModelRunner[] = [];
    for (const name of names) {
      const runner = this.runners.get(name);
      if (runner) out.push(runner);
    }
    return out;
  }
}

export class MissingRunnerError extends Error {
  public readonly runnerName: string;

  constructor(runnerName: string) {
    super(`ModelRunner not registered: ${runnerName}`);
    this.name = "MissingRunnerError";
    this.runnerName = runnerName;
  }
}
