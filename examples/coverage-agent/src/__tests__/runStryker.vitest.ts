import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SpawnFn } from "@lotiai/agent-kit/ports";
import { describe, expect, test, vi } from "vitest";
import { runStrykerOnFile } from "../runner/runStryker.js";

function makePackageWithStrykerTmp(): { packageDir: string; sandboxDir: string } {
  const packageDir = mkdtempSync(join(tmpdir(), "coverage-agent-stryker-"));
  // Write a minimal package.json so path layout is realistic.
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({ name: "@loti/fake-target", version: "1.0.0" }),
    "utf8",
  );
  // Plant a fake .stryker-tmp/sandbox-XYZ from a prior crashed run.
  const sandboxDir = resolve(packageDir, ".stryker-tmp", "sandbox-leftover");
  mkdirSync(sandboxDir, { recursive: true });
  writeFileSync(
    join(sandboxDir, "package.json"),
    JSON.stringify({ name: "@loti/fake-target", version: "1.0.0" }),
    "utf8",
  );
  return { packageDir, sandboxDir };
}

describe("runStrykerOnFile cleanup", () => {
  test("removes .stryker-tmp after a successful run", () => {
    const { packageDir, sandboxDir } = makePackageWithStrykerTmp();
    const spawn: SpawnFn = vi.fn(() => ({ stdout: "", stderr: "", exitCode: 0, signal: null }));

    runStrykerOnFile({
      packageDir,
      targetFile: "src/foo.ts",
      spawn,
    });

    expect(existsSync(sandboxDir)).toBe(false);
    expect(existsSync(resolve(packageDir, ".stryker-tmp"))).toBe(false);
    // stryker.conf.json is also cleaned up by the existing finally branch.
    expect(existsSync(resolve(packageDir, "stryker.conf.json"))).toBe(false);
  });

  test("removes .stryker-tmp even when the stryker subprocess exits non-zero", () => {
    const { packageDir, sandboxDir } = makePackageWithStrykerTmp();
    const spawn: SpawnFn = vi.fn(() => ({
      stdout: "",
      stderr: "stryker crashed",
      exitCode: 1,
      signal: null,
    }));

    const result = runStrykerOnFile({
      packageDir,
      targetFile: "src/foo.ts",
      spawn,
    });

    expect(result.exitCode).toBe(1);
    expect(result.mutationScore).toBeNull();
    expect(existsSync(sandboxDir)).toBe(false);
    expect(existsSync(resolve(packageDir, ".stryker-tmp"))).toBe(false);
  });

  test("does not throw when .stryker-tmp is absent (first run)", () => {
    const packageDir = mkdtempSync(join(tmpdir(), "coverage-agent-stryker-"));
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "@loti/fake-target", version: "1.0.0" }),
      "utf8",
    );
    const spawn: SpawnFn = vi.fn(() => ({ stdout: "", stderr: "", exitCode: 0, signal: null }));

    expect(() =>
      runStrykerOnFile({
        packageDir,
        targetFile: "src/foo.ts",
        spawn,
      }),
    ).not.toThrow();
  });

  test("ignores a stale mutation report when the current run does not write one", () => {
    const packageDir = mkdtempSync(join(tmpdir(), "coverage-agent-stryker-"));
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "@loti/fake-target", version: "1.0.0" }),
      "utf8",
    );
    const reportPath = resolve(packageDir, "reports/mutation/mutation.json");
    mkdirSync(resolve(packageDir, "reports/mutation"), { recursive: true });
    writeFileSync(
      reportPath,
      JSON.stringify({
        systemUnderTestMetrics: { metrics: { mutationScore: 91 } },
      }),
      "utf8",
    );
    const spawn: SpawnFn = vi.fn(() => ({
      stdout: "",
      stderr: "stryker crashed before writing report",
      exitCode: 1,
      signal: null,
    }));

    const result = runStrykerOnFile({
      packageDir,
      targetFile: "src/foo.ts",
      spawn,
    });

    expect(result.exitCode).toBe(1);
    expect(result.mutationScore).toBeNull();
    expect(existsSync(reportPath)).toBe(false);
  });
});
