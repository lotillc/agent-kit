import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { ensureNodeOnPath, findBinDir } from "../ensurePath.js";

describe("ensureNodeOnPath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("prepends node's directory when absent from PATH", () => {
    const nodeDir = dirname(process.execPath);
    const result = ensureNodeOnPath(["/usr/bin", "/bin"].join(delimiter));
    expect(result.startsWith(`${nodeDir}${delimiter}`)).toBe(true);
  });

  test("does not duplicate node's directory when already on PATH", () => {
    const nodeDir = dirname(process.execPath);
    const original = [nodeDir, "/usr/bin"].join(delimiter);
    const result = ensureNodeOnPath(original);
    const occurrences = result.split(delimiter).filter((p) => p === nodeDir).length;
    expect(occurrences).toBe(1);
  });

  test("returns node's dir even when current PATH is undefined", () => {
    const nodeDir = dirname(process.execPath);
    const result = ensureNodeOnPath(undefined);
    expect(result).toContain(nodeDir);
  });

  test("VOLTA_HOME/bin is only added when the dir exists on disk", () => {
    vi.stubEnv("VOLTA_HOME", "/nonexistent/path/42");
    const nodeDir = dirname(process.execPath);
    const result = ensureNodeOnPath("/usr/bin");
    expect(result).toContain(nodeDir);
    expect(result).not.toContain("/nonexistent/path/42/bin");
  });

  test("finds pnpm in a PATH dir separate from node (CI setup-pnpm shape)", () => {
    const pnpmDir = mkdtempSync(join(tmpdir(), "fake-pnpm-"));
    symlinkSync(process.execPath, join(pnpmDir, "pnpm"));

    const nodeDir = dirname(process.execPath);
    const currentPath = [pnpmDir, "/usr/bin"].join(delimiter);
    const result = ensureNodeOnPath(currentPath);

    expect(result.split(delimiter)[0]).toBe(nodeDir);
    const occurrences = result.split(delimiter).filter((p) => p === pnpmDir).length;
    expect(occurrences).toBe(1);
  });

  test("returns original PATH unchanged when nothing new to prepend", () => {
    const nodeDir = dirname(process.execPath);
    vi.stubEnv("VOLTA_HOME", "");
    const result = ensureNodeOnPath(nodeDir);
    expect(result).toBe(nodeDir);
  });

  test("front-loads node's dir even when it is already present but de-prioritized", () => {
    const nodeDir = dirname(process.execPath);
    vi.stubEnv("VOLTA_HOME", "");
    const result = ensureNodeOnPath(["/usr/bin", nodeDir].join(delimiter));
    expect(result.split(delimiter)[0]).toBe(nodeDir);
    // Moved to the front rather than duplicated.
    expect(result.split(delimiter).filter((p) => p === nodeDir).length).toBe(1);
  });

  test("drops empty PATH segments so CWD is not implicitly searched", () => {
    vi.stubEnv("VOLTA_HOME", "");
    const result = ensureNodeOnPath(["", "/usr/bin", ""].join(delimiter));
    expect(result.split(delimiter)).not.toContain("");
  });
});

describe("findBinDir", () => {
  test("returns the dir containing the executable", () => {
    const pnpmDir = mkdtempSync(join(tmpdir(), "fake-bin-"));
    symlinkSync(process.execPath, join(pnpmDir, "myprog"));
    const result = findBinDir("myprog", [pnpmDir, "/usr/bin"].join(delimiter));
    expect(result).toBe(pnpmDir);
  });

  test("returns undefined when not found", () => {
    expect(findBinDir("nonexistent-prog-xyz", "/usr/bin:/bin")).toBeUndefined();
  });

  test("skips empty PATH entries", () => {
    const pnpmDir = mkdtempSync(join(tmpdir(), "fake-bin-"));
    symlinkSync(process.execPath, join(pnpmDir, "other"));
    const result = findBinDir("other", `::${pnpmDir}::`);
    expect(result).toBe(pnpmDir);
  });
});
