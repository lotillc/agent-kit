import { describe, expect, test } from "vitest";

import { applyEnvOverrides, resolveAuth } from "../auth.js";

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
    expect(result.envOverrides).toEqual({ ANTHROPIC_API_KEY: null });
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
    expect(result.envOverrides).toEqual({ ANTHROPIC_API_KEY: null });
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
    expect(result.envOverrides).toEqual({ ANTHROPIC_API_KEY: null });
  });

  test("explicit oauth actively unsets ANTHROPIC_API_KEY (precedence trap)", () => {
    const result = resolveAuth({ mode: "oauth", cwd: "/repo", anthropicApiKey: "sk-stale" });
    expect(result.mode).toBe("oauth");
    expect(result.extraArgs).toEqual([]);
    expect(result.envOverrides).toEqual({ ANTHROPIC_API_KEY: null });
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
