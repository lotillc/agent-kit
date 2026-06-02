// Static list of packages the agent will never pick. Populated over time from
// PR review (greenfield, deprecated, or integration-only packages).
//
// Match is by `name` field in the package's package.json.
export const EXCLUDED_PACKAGES: ReadonlySet<string> = new Set<string>([]);

export const MIN_PACKAGE_LOC = 500;
export const MAX_FILE_LOC = 500;
export const MIN_BARREL_INDEX_LOC = 20;
export const COOLDOWN_DAYS = 14;

export const EXCLUDED_FILE_PATTERNS: ReadonlyArray<RegExp> = [
  /\.d\.ts$/,
  /(^|[/.])types\.ts$/,
  /(^|\/)types\//,
  /(^|[/.])config\.ts$/,
  /(^|[/.])setup\.ts$/,
  /(^|\/)migrations\//,
  /(^|\/)generated\//,
  /(^|\/)__generated__\//,
  /\.vitest\.ts$/,
  /\.fixtures?\.ts$/,
  /(^|\/)__tests__\//,
];
