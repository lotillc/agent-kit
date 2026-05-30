import { describe, expect, test } from "vitest";

import type { ModelRunner } from "../../ports/ModelRunner.js";
import { MissingRunnerError, ModelRegistry } from "../ModelRegistry.js";

const fake = (name: string): ModelRunner => ({
  name,
  runReview: async () => ({ success: true, rawOutput: "", durationMs: 0 }),
  runGenerate: async () => ({ success: true, rawOutput: "", durationMs: 0 }),
});

describe("ModelRegistry", () => {
  test("register + get round-trips", () => {
    const reg = new ModelRegistry();
    reg.register(fake("a"));
    expect(reg.get("a")?.name).toBe("a");
  });

  test("getOrThrow throws MissingRunnerError when absent", () => {
    const reg = new ModelRegistry();
    try {
      reg.getOrThrow("nope");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingRunnerError);
      expect((err as MissingRunnerError).runnerName).toBe("nope");
    }
  });

  test("all returns every registered runner", () => {
    const reg = new ModelRegistry();
    reg.register(fake("a"));
    reg.register(fake("b"));
    expect(
      reg
        .all()
        .map((r) => r.name)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  test("getMany filters out missing names without throwing", () => {
    const reg = new ModelRegistry();
    reg.register(fake("a"));
    reg.register(fake("c"));
    expect(reg.getMany(["a", "missing", "c"]).map((r) => r.name)).toEqual(["a", "c"]);
  });

  test("register replaces an existing runner of the same name", () => {
    const reg = new ModelRegistry();
    reg.register(fake("a"));
    const replacement = fake("a");
    reg.register(replacement);
    expect(reg.get("a")).toBe(replacement);
  });
});
