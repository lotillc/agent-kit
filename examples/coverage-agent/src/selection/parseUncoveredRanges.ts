import { existsSync, readFileSync } from "node:fs";
import libCoverage from "istanbul-lib-coverage";

/**
 * A contiguous range of uncovered lines in the target source file.
 * `end` is inclusive. Single-line ranges have start === end.
 */
export interface UncoveredRange {
  start: number;
  end: number;
  type: "statement" | "branch";
}

/**
 * Discriminated result of attempting to derive uncovered ranges. The caller
 * logs and falls back to "no hint block in the prompt" when kind !== "ok".
 */
export type ParseUncoveredRangesResult =
  | { kind: "ok"; ranges: UncoveredRange[] }
  | { kind: "missing-file"; coverageFinalPath: string }
  | { kind: "parse-failed"; coverageFinalPath: string; message: string }
  | { kind: "target-not-in-summary"; absoluteTargetPath: string; fileCount: number };

/**
 * Extract uncovered line ranges for a target file from vitest's istanbul
 * `coverage-final.json`. Never throws; returns a discriminated result so the
 * caller can log the specific failure.
 *
 * Note: `coverage-final.json` is istanbul-shaped even when vitest uses
 * `coverage.provider: 'v8'` — the v8 provider emits istanbul-format reports
 * via c8. Any other provider that doesn't emit this file will land in the
 * `missing-file` or `parse-failed` branches.
 *
 * Delegates istanbul parsing to `istanbul-lib-coverage` (the same library
 * vitest/c8 use to emit the file) so quirky shapes — null line values, empty
 * location objects for implicit branch arms — are handled natively instead of
 * by a hand-rolled Zod schema.
 */
export function parseUncoveredRanges(
  coverageFinalPath: string,
  absoluteTargetPath: string,
): ParseUncoveredRangesResult {
  if (!existsSync(coverageFinalPath)) {
    return { kind: "missing-file", coverageFinalPath };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(coverageFinalPath, "utf8"));
  } catch (err) {
    return {
      kind: "parse-failed",
      coverageFinalPath,
      message: (err as Error).message.slice(0, 200),
    };
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "parse-failed", coverageFinalPath, message: "root is not an object" };
  }

  const fileKeys = Object.keys(raw as Record<string, unknown>);
  if (!fileKeys.includes(absoluteTargetPath)) {
    return {
      kind: "target-not-in-summary",
      absoluteTargetPath,
      fileCount: fileKeys.length,
    };
  }

  let fileCov: libCoverage.FileCoverage;
  try {
    const map = libCoverage.createCoverageMap(raw as libCoverage.CoverageMapData);
    fileCov = map.fileCoverageFor(absoluteTargetPath);
  } catch (err) {
    return {
      kind: "parse-failed",
      coverageFinalPath,
      message: (err as Error).message.slice(0, 200),
    };
  }

  const statementLines = fileCov
    .getUncoveredLines()
    .map((l) => Number(l))
    .filter((n) => Number.isFinite(n) && n > 0);

  const branchByLine = fileCov.getBranchCoverageByLine();
  const branchLines = Object.entries(branchByLine)
    .filter(([, data]) => data.covered < data.total)
    .map(([line]) => Number(line))
    .filter((n) => Number.isFinite(n) && n > 0);

  const ranges = [
    ...collapseContiguous(statementLines, "statement"),
    ...collapseContiguous(branchLines, "branch"),
  ].sort((a, b) => a.start - b.start || a.end - b.end);

  return { kind: "ok", ranges };
}

/**
 * Collapse a flat list of line numbers into contiguous [start,end] ranges of
 * the given type. Duplicates are deduped; adjacent lines (n, n+1) merge.
 */
function collapseContiguous(lines: number[], type: "statement" | "branch"): UncoveredRange[] {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const out: UncoveredRange[] = [];
  for (const line of sorted) {
    const prev = out[out.length - 1];
    if (prev && line <= prev.end + 1) {
      prev.end = line;
    } else {
      out.push({ start: line, end: line, type });
    }
  }
  return out;
}
