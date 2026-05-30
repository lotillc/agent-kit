/**
 * Common severity enum for review findings. Sorted most-urgent-first.
 */
export const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

export type Severity = (typeof SEVERITY_ORDER)[number];

/**
 * Compare severities in descending urgency. `critical` < `high` < … < `info`.
 * Returns the spaceship semantics for `Array.sort` (−1 = a comes first).
 */
export const compareSeverity = (a: Severity, b: Severity): number =>
  SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b);

/** Normalize an arbitrary string to a Severity, falling back to `"low"`. */
export const normalizeSeverity = (raw: string): Severity => {
  const lowered = raw.trim().toLowerCase();
  return (SEVERITY_ORDER as readonly string[]).includes(lowered) ? (lowered as Severity) : "low";
};
