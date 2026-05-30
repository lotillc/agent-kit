import { describe, expect, test } from "vitest";

import { createPromptBank } from "../promptBank.js";
import { formatPromptVersion, stampPromptVersion } from "../versioning.js";

describe("createPromptBank", () => {
  test("register + get round-trips", () => {
    const bank = createPromptBank();
    bank.register({ name: "review", description: "d", systemPrompt: "sp" });
    expect(bank.get("review")?.systemPrompt).toBe("sp");
  });

  test("names lists everything registered", () => {
    const bank = createPromptBank();
    bank.loadMany([
      { name: "a", description: "", systemPrompt: "" },
      { name: "b", description: "", systemPrompt: "" },
    ]);
    expect(bank.names().sort()).toEqual(["a", "b"]);
  });

  test("loadMany replaces same-named entries", () => {
    const bank = createPromptBank();
    bank.register({ name: "x", description: "old", systemPrompt: "" });
    bank.loadMany([{ name: "x", description: "new", systemPrompt: "" }]);
    expect(bank.get("x")?.description).toBe("new");
  });

  test("get returns null for missing", () => {
    expect(createPromptBank().get("nope")).toBeNull();
  });
});

describe("stampPromptVersion", () => {
  test("adds the version field to the artifact", () => {
    const out = stampPromptVersion({ a: 1 }, "v2");
    expect(out).toEqual({ a: 1, promptVersion: "v2" });
  });

  test("honors a custom field name", () => {
    const out = stampPromptVersion({ a: 1 }, "v1", "v");
    expect(out).toEqual({ a: 1, v: "v1" });
  });
});

describe("formatPromptVersion", () => {
  test("formats as id@v<n>", () => {
    expect(formatPromptVersion("coverage", 1)).toBe("coverage@v1");
    expect(formatPromptVersion("x", "rc2")).toBe("x@vrc2");
  });
});
