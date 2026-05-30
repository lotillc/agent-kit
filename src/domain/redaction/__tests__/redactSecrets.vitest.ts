import { describe, expect, test } from "vitest";

import { redactSecrets } from "../redactSecrets.js";

describe("redactSecrets", () => {
  test("masks caller-supplied literal secrets", () => {
    expect(redactSecrets("token=supersecretvalue done", { secrets: ["supersecretvalue"] })).toBe(
      "token=[REDACTED] done",
    );
  });

  test("ignores literal secrets shorter than the minimum length", () => {
    expect(redactSecrets("abc abc", { secrets: ["abc"] })).toBe("abc abc");
  });

  test("masks Anthropic, GitHub, and AWS token shapes", () => {
    expect(redactSecrets("key sk-ant-abcd1234EFGH")).toBe("key [REDACTED]");
    expect(redactSecrets("ghp_0123456789abcdef0123")).toBe("[REDACTED]");
    expect(redactSecrets("github_pat_11ABCDEFG0_abcdefghij1234567890")).toBe("[REDACTED]");
    expect(redactSecrets("AKIAIOSFODNN7EXAMPLE")).toBe("[REDACTED]");
  });

  test("masks bearer and x-access-token headers", () => {
    expect(redactSecrets("Authorization: Bearer abcDEF123456._-")).toBe(
      "Authorization: Bearer [REDACTED]",
    );
    expect(redactSecrets("x-access-token:ghs_tokenvalue12345@github.com")).toBe(
      "x-access-token:[REDACTED]@github.com",
    );
    // Header form with a space after the colon.
    expect(redactSecrets("x-access-token: tok123value456")).toBe("x-access-token:[REDACTED]");
  });

  test("leaves ordinary prose untouched", () => {
    const text = "Spawned claude with model sonnet, 3 turns, exit 0.";
    expect(redactSecrets(text)).toBe(text);
  });
});
