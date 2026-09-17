import { describe, expect, test } from "vitest";

import { applyEnvOverrides, FederationConfigError, resolveAuth } from "../auth.js";

describe("resolveAuth", () => {
  test("auto → bare when an API key is supplied", () => {
    const result = resolveAuth({ mode: "auto", cwd: "/work", anthropicApiKey: "sk-abc" });
    expect(result.mode).toBe("bare");
    expect(result.extraArgs).toEqual(["--bare", "--add-dir", "/work"]);
    expect(result.envOverrides).toEqual({ ANTHROPIC_API_KEY: "sk-abc" });
  });

  test("auto → oauth when no API key is supplied", () => {
    const result = resolveAuth({ mode: "auto", cwd: "/work" });
    expect(result.mode).toBe("oauth");
    expect(result.extraArgs).toEqual([]);
    expect(result.envOverrides).toEqual({
      ANTHROPIC_API_KEY: null,
      ANTHROPIC_IDENTITY_TOKEN_FILE: null,
      ANTHROPIC_IDENTITY_TOKEN: null,
    });
  });

  test("explicit bare emits --bare --add-dir and sets API key env", () => {
    const result = resolveAuth({ mode: "bare", cwd: "/repo", anthropicApiKey: "sk-xyz" });
    expect(result.mode).toBe("bare");
    expect(result.extraArgs).toEqual(["--bare", "--add-dir", "/repo"]);
    expect(result.envOverrides).toEqual({ ANTHROPIC_API_KEY: "sk-xyz" });
  });

  test("bare with no key from arg or env unsets ANTHROPIC_API_KEY so the CLI errors loudly", () => {
    const result = resolveAuth({ mode: "bare", cwd: "/repo" });
    expect(result.mode).toBe("bare");
    expect(result.extraArgs).toEqual(["--bare", "--add-dir", "/repo"]);
    expect(result.envOverrides).toEqual({ ANTHROPIC_API_KEY: null });
  });

  test("auto → bare using the env ANTHROPIC_API_KEY when no key arg is passed", () => {
    const result = resolveAuth({ mode: "auto", cwd: "/work", envApiKey: "sk-env" });
    expect(result.mode).toBe("bare");
    expect(result.extraArgs).toEqual(["--bare", "--add-dir", "/work"]);
    // The env key is set explicitly (trimmed), not left to raw inheritance.
    expect(result.envOverrides).toEqual({ ANTHROPIC_API_KEY: "sk-env" });
  });

  test("auto → oauth when the env key is an empty string", () => {
    const result = resolveAuth({ mode: "auto", cwd: "/work", envApiKey: "" });
    expect(result.mode).toBe("oauth");
    expect(result.envOverrides).toEqual({
      ANTHROPIC_API_KEY: null,
      ANTHROPIC_IDENTITY_TOKEN_FILE: null,
      ANTHROPIC_IDENTITY_TOKEN: null,
    });
  });

  test("an explicit arg overrides the env key", () => {
    const result = resolveAuth({
      mode: "auto",
      cwd: "/work",
      anthropicApiKey: "sk-arg",
      envApiKey: "sk-env",
    });
    expect(result.mode).toBe("bare");
    expect(result.envOverrides).toEqual({ ANTHROPIC_API_KEY: "sk-arg" });
  });

  test("bare uses the env key when no arg is passed", () => {
    const result = resolveAuth({ mode: "bare", cwd: "/repo", envApiKey: "sk-env" });
    expect(result.mode).toBe("bare");
    expect(result.envOverrides).toEqual({ ANTHROPIC_API_KEY: "sk-env" });
  });

  test("trims surrounding whitespace/newlines from the key", () => {
    const result = resolveAuth({ mode: "bare", cwd: "/repo", anthropicApiKey: "  sk-pad \n" });
    expect(result.envOverrides).toEqual({ ANTHROPIC_API_KEY: "sk-pad" });
  });

  test("explicit oauth unsets the key even when the env key is present", () => {
    const result = resolveAuth({ mode: "oauth", cwd: "/repo", envApiKey: "sk-env" });
    expect(result.mode).toBe("oauth");
    expect(result.envOverrides).toEqual({
      ANTHROPIC_API_KEY: null,
      ANTHROPIC_IDENTITY_TOKEN_FILE: null,
      ANTHROPIC_IDENTITY_TOKEN: null,
    });
  });

  test("explicit oauth actively unsets ANTHROPIC_API_KEY (precedence trap)", () => {
    const result = resolveAuth({ mode: "oauth", cwd: "/repo", anthropicApiKey: "sk-stale" });
    expect(result.mode).toBe("oauth");
    expect(result.extraArgs).toEqual([]);
    expect(result.envOverrides).toEqual({
      ANTHROPIC_API_KEY: null,
      ANTHROPIC_IDENTITY_TOKEN_FILE: null,
      ANTHROPIC_IDENTITY_TOKEN: null,
    });
  });

  test("auto → oauth when the explicit key is empty or whitespace-only", () => {
    expect(resolveAuth({ mode: "auto", cwd: "/work", anthropicApiKey: "" }).mode).toBe("oauth");
    expect(resolveAuth({ mode: "auto", cwd: "/work", anthropicApiKey: "   " }).mode).toBe("oauth");
  });

  test("bare with an empty explicit key unsets ANTHROPIC_API_KEY (not bare with an empty key)", () => {
    const result = resolveAuth({ mode: "bare", cwd: "/repo", anthropicApiKey: "" });
    expect(result.mode).toBe("bare");
    expect(result.envOverrides).toEqual({ ANTHROPIC_API_KEY: null });
  });
});

describe("resolveAuth federation", () => {
  test("omits --bare, which cannot reach the federation env vars at all", () => {
    const result = resolveAuth({ mode: "federation", cwd: "/repo", identityTokenFile: "/run/a" });
    expect(result.mode).toBe("federation");
    expect(result.extraArgs).not.toContain("--bare");
  });

  // cwd is already the spawn directory and only `--bare` disables CLAUDE.md discovery,
  // so --add-dir would be a no-op -- same as `oauth`, which passes no args either.
  test("passes no extra args, matching the other non-bare mode", () => {
    const result = resolveAuth({ mode: "federation", cwd: "/repo", identityTokenFile: "/run/a" });
    expect(result.extraArgs).toEqual([]);
  });

  // Both outrank federation in the CLI's credential chain; either inherited from the
  // environment would silently win and federation would never run.
  // Each of these satisfies the CLI on its own, so an inherited one would win and the
  // requested federation identity would never be used.
  test.each(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"])(
    "unsets %s, which would otherwise outrank federation",
    (name) => {
      const result = resolveAuth({ mode: "federation", cwd: "/repo", identityTokenFile: "/run/a" });
      expect(result.envOverrides[name]).toBeNull();
    },
  );

  // These route the CLI to Bedrock/Vertex/Foundry on their own credentials, so an
  // inherited one would ignore the assertion entirely and nothing would fail.
  test.each(["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"])(
    "unsets %s, which would route around the Anthropic API",
    (name) => {
      const result = resolveAuth({ mode: "federation", cwd: "/repo", identityTokenFile: "/run/a" });
      expect(result.envOverrides[name]).toBeNull();
    },
  );

  test("unsets them even when a key was supplied explicitly", () => {
    const result = resolveAuth({
      mode: "federation",
      cwd: "/repo",
      identityTokenFile: "/run/a",
      anthropicApiKey: "sk-ant-x",
    });
    expect(result.envOverrides.ANTHROPIC_API_KEY).toBeNull();
  });

  test("points the CLI at the identity token file when one is given", () => {
    const result = resolveAuth({
      mode: "federation",
      cwd: "/repo",
      identityTokenFile: "/run/token-2",
    });
    expect(result.envOverrides.ANTHROPIC_IDENTITY_TOKEN_FILE).toBe("/run/token-2");
  });

  test("adopts an inherited identity token file when no explicit one is given", () => {
    const result = resolveAuth({
      mode: "federation",
      cwd: "/repo",
      envIdentityTokenFile: "/run/inherited",
    });
    expect(result.envOverrides.ANTHROPIC_IDENTITY_TOKEN_FILE).toBe("/run/inherited");
  });

  test("an explicit file wins over the inherited one", () => {
    const result = resolveAuth({
      mode: "federation",
      cwd: "/repo",
      identityTokenFile: "/run/explicit",
      envIdentityTokenFile: "/run/inherited",
    });
    expect(result.envOverrides.ANTHROPIC_IDENTITY_TOKEN_FILE).toBe("/run/explicit");
  });

  // The literal-assertion form is a valid federation setup, so it must not be refused,
  // and there is no file path to set.
  test("accepts an inherited literal assertion with no file", () => {
    const result = resolveAuth({ mode: "federation", cwd: "/repo", envIdentityToken: "eyJ..." });
    expect(result.mode).toBe("federation");
    expect("ANTHROPIC_IDENTITY_TOKEN_FILE" in result.envOverrides).toBe(false);
  });

  // Without an assertion, and with --bare omitted, the CLI would fall through to a cached
  // OAuth session and run as whoever that is. Refusing is the only safe outcome.
  test("refuses federation with no assertion from any source", () => {
    expect(() => resolveAuth({ mode: "federation", cwd: "/repo" })).toThrow(
      /requires an identity token/,
    );
  });

  test("refuses a blank identity token file", () => {
    expect(() =>
      resolveAuth({ mode: "federation", cwd: "/repo", identityTokenFile: "   " }),
    ).toThrow(/requires an identity token/);
  });

  // Exhaustive, unlike an per-key check: it also pins what must NOT be there, so a
  // spurious override or a clear of the literal-assertion var fails here.
  test("writes exactly the expected federation overrides and nothing else", () => {
    const result = resolveAuth({ mode: "federation", cwd: "/repo", identityTokenFile: "/run/a" });
    expect(result.envOverrides).toEqual({
      ANTHROPIC_API_KEY: null,
      ANTHROPIC_AUTH_TOKEN: null,
      CLAUDE_CODE_OAUTH_TOKEN: null,
      CLAUDE_CODE_USE_BEDROCK: null,
      CLAUDE_CODE_USE_VERTEX: null,
      CLAUDE_CODE_USE_FOUNDRY: null,
      ANTHROPIC_IDENTITY_TOKEN_FILE: "/run/a",
    });
  });

  // Clearing it would break the literal form the resolver deliberately accepts.
  test("never clears ANTHROPIC_IDENTITY_TOKEN, which is a valid assertion source", () => {
    const result = resolveAuth({ mode: "federation", cwd: "/repo", envIdentityToken: "eyJ..." });
    expect("ANTHROPIC_IDENTITY_TOKEN" in result.envOverrides).toBe(false);
  });

  // A path from `$(mktemp)` carries a trailing newline; untrimmed it reaches the CLI verbatim.
  test("trims an explicit identity token file", () => {
    const result = resolveAuth({
      mode: "federation",
      cwd: "/repo",
      identityTokenFile: "  /run/a \n",
    });
    expect(result.envOverrides.ANTHROPIC_IDENTITY_TOKEN_FILE).toBe("/run/a");
  });

  // Blank is not configured. Accepting it would let the run fall through to a cached
  // OAuth session with no credential at all -- what the throw exists to prevent.
  test.each(["envIdentityTokenFile", "envIdentityToken"])("refuses a blank %s", (field) => {
    expect(() =>
      resolveAuth({ mode: "federation", cwd: "/repo", [field]: "   " }),
    ).toThrow(/requires an identity token/);
  });

  // The explicit-key half is covered above; this pins the inherited half, so an ambient
  // key cannot quietly downgrade an explicitly requested federation run to bare.
  test("refusal is a named error, so consumers need not match on the message", () => {
    expect(() => resolveAuth({ mode: "federation", cwd: "/repo" })).toThrow(FederationConfigError);
  });

  test("an inherited API key does not downgrade an explicit federation request", () => {
    const result = resolveAuth({
      mode: "federation",
      cwd: "/repo",
      identityTokenFile: "/run/a",
      envApiKey: "sk-env",
    });
    expect(result.mode).toBe("federation");
    expect(result.envOverrides.ANTHROPIC_API_KEY).toBeNull();
  });

  test("auto never selects federation implicitly", () => {
    expect(resolveAuth({ mode: "auto", cwd: "/repo" }).mode).toBe("oauth");
    expect(resolveAuth({ mode: "auto", cwd: "/repo", envApiKey: "k" }).mode).toBe("bare");
  });
});

describe("resolveAuth oauth clears inherited federation credentials", () => {
  // A federated CI job exports these at job level. Without clearing them an explicit
  // "use the cached session" would federate anyway, and the auth= log line would lie.
  test.each(["ANTHROPIC_IDENTITY_TOKEN_FILE", "ANTHROPIC_IDENTITY_TOKEN"])(
    "unsets %s so an explicit oauth request cannot federate",
    (name) => {
      expect(resolveAuth({ mode: "oauth", cwd: "/repo" }).envOverrides[name]).toBeNull();
    },
  );

  test("auto resolving to oauth clears them too", () => {
    const result = resolveAuth({ mode: "auto", cwd: "/repo" });
    expect(result.mode).toBe("oauth");
    expect(result.envOverrides.ANTHROPIC_IDENTITY_TOKEN_FILE).toBeNull();
  });
});

describe("applyEnvOverrides", () => {
  test("sets string values and removes null values", () => {
    const base: NodeJS.ProcessEnv = { FOO: "original", BAR: "keep" };
    const result = applyEnvOverrides(base, { FOO: "new", BAR: null, BAZ: "added" });
    expect(result).toEqual({ FOO: "new", BAZ: "added" });
    expect("BAR" in result).toBe(false);
  });

  test("does not mutate the base env", () => {
    const base: NodeJS.ProcessEnv = { FOO: "original" };
    applyEnvOverrides(base, { FOO: "changed" });
    expect(base).toEqual({ FOO: "original" });
  });

  test("no-op overrides produce a copy", () => {
    const base: NodeJS.ProcessEnv = { FOO: "bar" };
    const result = applyEnvOverrides(base, {});
    expect(result).toEqual(base);
    expect(result).not.toBe(base);
  });
});
