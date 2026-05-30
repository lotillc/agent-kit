import type { Severity } from "./severity.js";

export interface SeverityFinding {
  severity: Severity;
}

export interface FileScopedSeverityFinding extends SeverityFinding {
  filePath: string;
}

/**
 * Blocking findings tear down generated files. Only `critical` qualifies.
 */
export const blockingFindings = <Finding extends SeverityFinding>(
  findings: ReadonlyArray<Finding>,
): Finding[] => findings.filter((f) => f.severity === "critical");

/**
 * Findings worth addressing during a fix-turn.
 *
 * `high` is actionable but not blocking.
 */
export const addressableFindings = <Finding extends SeverityFinding>(
  findings: ReadonlyArray<Finding>,
): Finding[] => findings.filter((f) => f.severity === "critical" || f.severity === "high");

/**
 * Pure drop planner. Matches blocking findings to generated files by suffix;
 * callers own any actual file edits or deletions.
 */
export interface DowngradeByFindingsInput {
  filesCreated: ReadonlyArray<string>;
  filesModified: ReadonlyArray<string>;
  findings: ReadonlyArray<FileScopedSeverityFinding>;
}

export interface DowngradeByFindingsResult {
  droppedFiles: string[];
  remainingCreated: string[];
  remainingModified: string[];
  downgraded: number;
  remaining: number;
}

export const downgradeTargetsByFindings = ({
  filesCreated,
  filesModified,
  findings,
}: DowngradeByFindingsInput): DowngradeByFindingsResult => {
  const blocking = blockingFindings(findings);
  const drop = new Set<string>();

  for (const finding of blocking) {
    for (const file of filesCreated) {
      if (file.endsWith(finding.filePath) || finding.filePath.endsWith(file)) drop.add(file);
    }
    for (const file of filesModified) {
      if (file.endsWith(finding.filePath) || finding.filePath.endsWith(file)) drop.add(file);
    }
  }

  const remainingCreated = filesCreated.filter((f) => !drop.has(f));
  const remainingModified = filesModified.filter((f) => !drop.has(f));

  return {
    droppedFiles: [...drop].sort(),
    remainingCreated,
    remainingModified,
    downgraded: drop.size,
    remaining: remainingCreated.length + remainingModified.length,
  };
};
