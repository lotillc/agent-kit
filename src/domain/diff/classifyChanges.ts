/**
 * Pure logic for classifying a working-tree diff into three buckets:
 *   - **test-only**: changes to files matching the test runner's patterns
 *   - **source export-keyword-only**: source-file changes that ONLY add the
 *     `export` / `export default` / `export async` keyword prefix to existing
 *     lines; no other change
 *   - **disallowed**: everything else
 *
 * This is the pure core of the `validateWorkingTreeDiff` guardrail. It takes
 * pre-read file contents and pre-computed
 * change lists, and returns a structured verdict. The adapter side
 * (`adapters/git/validateDiff.ts`) wraps git + fs reads around this.
 */

export interface FileDiff {
  path: string;
  oldSource: string;
  newSource: string;
}

export interface ClassifyChangesInput {
  /** Added, modified, or renamed files in the working tree. */
  changedFiles: ReadonlyArray<FileDiff>;
  /** Regex patterns that a path matches if it is a test file. */
  testFilePatterns: ReadonlyArray<RegExp>;
  /** Source-directory pattern (whitelist for export-keyword-only exception). */
  sourcePathPattern: RegExp;
}

export interface ClassifyChangesResult {
  ok: boolean;
  testFiles: string[];
  exportOnlyEdits: string[];
  disallowed: string[];
}

export const classifyChanges = ({
  changedFiles,
  testFilePatterns,
  sourcePathPattern,
}: ClassifyChangesInput): ClassifyChangesResult => {
  const testFiles: string[] = [];
  const exportOnlyEdits: string[] = [];
  const disallowed: string[] = [];

  for (const file of changedFiles) {
    if (testFilePatterns.some((p) => testStateless(p, file.path))) {
      testFiles.push(file.path);
      continue;
    }
    if (
      testStateless(sourcePathPattern, file.path) &&
      diffIsExportKeywordsOnly(file.oldSource, file.newSource)
    ) {
      exportOnlyEdits.push(file.path);
      continue;
    }
    disallowed.push(file.path);
  }

  return {
    ok: disallowed.length === 0,
    testFiles,
    exportOnlyEdits,
    disallowed,
  };
};

/**
 * `RegExp.prototype.test` keeps state in `lastIndex` when the pattern has the
 * `g` or `y` flag — successive `.test()` calls on the same RegExp can alternate
 * between match and non-match. Consumers occasionally pass `/…/g` test-path
 * patterns from config; resetting `lastIndex` makes classification independent
 * of file ordering and call count.
 */
const testStateless = (pattern: RegExp, value: string): boolean => {
  pattern.lastIndex = 0;
  return pattern.test(value);
};

/**
 * Return `true` iff every line difference between `oldSource` and `newSource`
 * is the addition of an `export` / `export default` / `export async` keyword
 * prefix on an otherwise-unchanged line.
 *
 * Line counts must match; any insertion or deletion fails the check.
 */
export const diffIsExportKeywordsOnly = (oldSource: string, newSource: string): boolean => {
  const oldLines = oldSource.split("\n");
  const newLines = newSource.split("\n");
  if (oldLines.length !== newLines.length) return false;
  for (let i = 0; i < oldLines.length; i += 1) {
    const a = oldLines[i]!;
    const b = newLines[i]!;
    if (a === b) continue;
    if (!lineAddsExportKeyword(a, b)) return false;
  }
  return true;
};

const EXPORT_PREFIXES = ["export default ", "export async ", "export "];

/**
 * Is `newLine` equal to `oldLine` with one of {`export `, `export default `,
 * `export async `} prefixed after the original indent?
 */
export const lineAddsExportKeyword = (oldLine: string, newLine: string): boolean => {
  const oldIndent = leadingWhitespace(oldLine);
  const newIndent = leadingWhitespace(newLine);
  if (oldIndent !== newIndent) return false;

  const oldBody = oldLine.slice(oldIndent.length);
  const newBody = newLine.slice(newIndent.length);
  for (const prefix of EXPORT_PREFIXES) {
    if (newBody === `${prefix}${oldBody}`) return true;
  }
  return false;
};

const leadingWhitespace = (line: string): string => {
  const match = line.match(/^\s*/);
  return match ? match[0] : "";
};
