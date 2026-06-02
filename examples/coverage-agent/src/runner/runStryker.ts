import { readFileSync, rmSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";

import type { SpawnFn } from "@lotiai/agent-kit/ports";
import { defaultSpawn } from "@lotiai/agent-kit/process";
import { z } from "zod";

import { writeStrykerConfig } from "../stryker/strykerConfig.js";

const localRequire = createRequire(import.meta.url);

const StrykerReportSchema = z.object({
  systemUnderTestMetrics: z.object({
    metrics: z.object({
      mutationScore: z.number(),
    }),
  }),
});

// Absolute path to the Stryker CLI JS, resolved via @stryker-mutator/core's
// package.json. Runs via `node <bin> run` so we don't depend on `pnpm exec`
// finding stryker in the target package's node_modules.
const STRYKER_PKG_JSON = localRequire.resolve("@stryker-mutator/core/package.json");
const STRYKER_BIN_JS = resolvePath(dirname(STRYKER_PKG_JSON), "bin", "stryker.js");

export type StrykerRunOptions = {
  /** Absolute path to the package under mutation. Stryker runs here (cwd). */
  packageDir: string;
  /**
   * Path relative to packageDir of the file to mutate. Retained as the
   * single-file convenience; `targetFiles` takes precedence when both are
   * supplied. Exactly one of the two must be provided.
   */
  targetFile?: string;
  /**
   * Paths (relative to packageDir) of files to mutate in one Stryker run.
   * Passed to Stryker's `mutate` array verbatim. Use this for batched runs
   * so we pay the Stryker startup cost once per batch rather than once per
   * file.
   */
  targetFiles?: readonly string[];
  /** Optional explicit report path (default: <packageDir>/reports/mutation/mutation.json). */
  reportJsonPath?: string;
  /** Per-test timeout in ms. Default 60s. */
  timeoutMs?: number;
  spawn?: SpawnFn;
};

export type StrykerRunResult = {
  /** null when Stryker was killed by a signal (see `@lotiai/agent-kit/ports` SpawnResult). */
  exitCode: number | null;
  mutationScore: number | null;
  stdout: string;
  stderr: string;
};

const STRYKER_CONFIG_NAME = "stryker.conf.json";

export function runStrykerOnFile(options: StrykerRunOptions): StrykerRunResult {
  const spawn = options.spawn ?? defaultSpawn;
  const configPath = resolvePath(options.packageDir, STRYKER_CONFIG_NAME);
  const reportPath =
    options.reportJsonPath ?? resolvePath(options.packageDir, "reports/mutation/mutation.json");

  // Write a temporary stryker config scoped to the target file(s), then
  // clean up on the way out regardless of success so the package doesn't
  // accumulate agent-generated artifacts.
  const mutatePaths =
    options.targetFiles && options.targetFiles.length > 0
      ? options.targetFiles
      : options.targetFile
        ? [options.targetFile]
        : undefined;
  if (!mutatePaths) {
    throw new Error("runStrykerOnFile: must supply either targetFile or a non-empty targetFiles");
  }
  writeStrykerConfig(configPath, {
    mutateRelativePaths: mutatePaths,
    reportJsonRelativePath: "reports/mutation/mutation.json",
    timeoutMs: options.timeoutMs,
  });

  try {
    rmSync(reportPath, { force: true });
    const res = spawn(process.execPath, [STRYKER_BIN_JS, "run"], {
      cwd: options.packageDir,
    });
    let mutationScore: number | null = null;
    try {
      const parsed = StrykerReportSchema.parse(JSON.parse(readFileSync(reportPath, "utf8")));
      mutationScore = parsed.systemUnderTestMetrics.metrics.mutationScore;
    } catch {
      mutationScore = null;
    }
    return {
      exitCode: res.exitCode,
      mutationScore,
      stdout: res.stdout,
      stderr: res.stderr,
    };
  } finally {
    try {
      unlinkSync(configPath);
    } catch {
      // best effort — config file may not have been created
    }
    // Stryker drops a sandbox at <packageDir>/.stryker-tmp/sandbox-XXXX that
    // contains a copy of the package (with the same `"name": "@loti/cli"` in
    // its package.json). If stryker crashes mid-run the sandbox is left
    // behind, and turbo then refuses to bootstrap with "workspace already
    // exists at tools/cli/package.json". Nuke the whole dir — stryker owns
    // it, and any orphaned sandboxes are never useful.
    try {
      rmSync(resolvePath(options.packageDir, ".stryker-tmp"), {
        recursive: true,
        force: true,
      });
    } catch {
      // best effort — dir may not exist
    }
  }
}
