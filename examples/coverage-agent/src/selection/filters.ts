import {
  EXCLUDED_FILE_PATTERNS,
  EXCLUDED_PACKAGES,
  MAX_FILE_LOC,
  MIN_BARREL_INDEX_LOC,
  MIN_PACKAGE_LOC,
} from "./exclusions.js";

export function isPackageExcluded(packageName: string): boolean {
  return EXCLUDED_PACKAGES.has(packageName);
}

export function isPackageUnderMinLoc(totalLines: number): boolean {
  return totalLines < MIN_PACKAGE_LOC;
}

/**
 * True if the repo-relative source path appears in the given set (derived
 * from stack ancestry or in-progress agent runs).
 */
export function isFileAlreadyCovered(
  sourceRepoRel: string,
  coveredSet: ReadonlySet<string>,
): boolean {
  return coveredSet.has(sourceRepoRel);
}

/**
 * True if the repo-relative source path is in the quarantine map. Quarantine
 * entries now come from `Quarantine-File:` commit trailers in the stack
 * ancestry rather than a persistent JSON file.
 */
export function isFileQuarantined(
  sourceRepoRel: string,
  quarantined: ReadonlyMap<string, string>,
): boolean {
  return quarantined.has(sourceRepoRel);
}

export function matchesExcludedFilePattern(relativePath: string): boolean {
  return EXCLUDED_FILE_PATTERNS.some((re) => re.test(relativePath));
}

export function isBarrelIndex(relativePath: string, totalLines: number): boolean {
  const isIndex = /(^|\/)index\.ts$/.test(relativePath);
  return isIndex && totalLines < MIN_BARREL_INDEX_LOC;
}

export function isFileTooLarge(totalLines: number): boolean {
  return totalLines > MAX_FILE_LOC;
}
