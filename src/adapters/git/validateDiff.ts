import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type ClassifyChangesResult,
  classifyChanges,
  type FileDiff,
} from "../../domain/diff/index.js";
import type { SpawnFn } from "../../ports/SpawnFn.js";
import { defaultSpawn } from "../process/defaultSpawn.js";

import { changedFiles, showFileAtRef } from "./simpleGitOps.js";

export interface ValidateWorkingTreeDiffInput {
  cwd: string;
  baseRef: string;
  testFilePatterns: ReadonlyArray<RegExp>;
  /** Source-directory whitelist; paths matching this AND export-only may slip through. */
  sourcePathPattern: RegExp;
  spawn?: SpawnFn;
  /** Override fs reads (testing seam). */
  readFile?: (absolutePath: string) => string;
}

/**
 * Wrap `classifyChanges` with the git + fs reads needed to compute `FileDiff`
 * records for every changed path. Adapter; the pure logic lives in
 * `domain/diff/classifyChanges.ts`.
 */
export const validateWorkingTreeDiff = (
  input: ValidateWorkingTreeDiffInput,
): ClassifyChangesResult => {
  const spawn = input.spawn ?? defaultSpawn;
  const readFile = input.readFile ?? ((abs: string) => readFileSync(abs, "utf-8"));

  const paths = changedFiles({ cwd: input.cwd, spawn }, input.baseRef);
  const diffs: FileDiff[] = paths.map((relPath) => ({
    path: relPath,
    // Both sides normalized to LF: `git show` blobs are always LF, but
    // `readFileSync` on a CRLF working tree (Windows, or `core.autocrlf=true`
    // on POSIX) returns CRLF. Without normalization, every unchanged line
    // would differ by a trailing `\r` and `diffIsExportKeywordsOnly` would
    // reject a valid export-only edit.
    oldSource: toLf(showFileAtRef({ cwd: input.cwd, spawn }, input.baseRef, relPath) ?? ""),
    newSource: toLf(safeRead(join(input.cwd, relPath), readFile)),
  }));

  return classifyChanges({
    changedFiles: diffs,
    testFilePatterns: input.testFilePatterns,
    sourcePathPattern: input.sourcePathPattern,
  });
};

const toLf = (text: string): string => text.replace(/\r\n/g, "\n");

const safeRead = (abs: string, readFile: (p: string) => string): string => {
  try {
    return readFile(abs);
  } catch {
    // File may have been deleted; treat as empty new source.
    return "";
  }
};
