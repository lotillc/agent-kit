import { inspect } from "node:util";
import { describe, expect, test } from "vitest";

import { revealSecret, Secret, wrapSecret } from "../secret.js";

describe("Secret", () => {
  test("reveal returns the underlying value", () => {
    expect(new Secret("sk-abc").reveal()).toBe("sk-abc");
  });

  test("toString returns [REDACTED] instead of leaking the value", () => {
    const secret = new Secret("sk-abc");
    expect(String(secret)).toBe("[REDACTED]");
    expect(`prefix=${secret}`).toBe("prefix=[REDACTED]");
  });

  test("JSON.stringify emits [REDACTED] instead of leaking the value", () => {
    const payload = { apiKey: new Secret("sk-abc"), other: 1 };
    expect(JSON.stringify(payload)).toBe('{"apiKey":"[REDACTED]","other":1}');
  });

  test("util.inspect emits [REDACTED] instead of leaking the value", () => {
    const payload = { apiKey: new Secret("sk-abc") };
    expect(inspect(payload)).toContain("[REDACTED]");
    expect(inspect(payload)).not.toContain("sk-abc");
  });
});

describe("revealSecret", () => {
  test("returns undefined for undefined", () => {
    expect(revealSecret(undefined)).toBeUndefined();
  });

  test("returns the string unchanged for a plain string", () => {
    expect(revealSecret("plain")).toBe("plain");
  });

  test("reveals a Secret", () => {
    expect(revealSecret(new Secret("hidden"))).toBe("hidden");
  });
});

describe("wrapSecret", () => {
  test("wraps a plain string", () => {
    const wrapped = wrapSecret("x");
    expect(wrapped).toBeInstanceOf(Secret);
    expect(wrapped?.reveal()).toBe("x");
  });

  test("passes through an existing Secret unchanged", () => {
    const original = new Secret("y");
    const wrapped = wrapSecret(original);
    expect(wrapped).toBe(original);
  });

  test("returns undefined for undefined", () => {
    expect(wrapSecret(undefined)).toBeUndefined();
  });
});
