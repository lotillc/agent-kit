/**
 * Canonical in-name marker for declaring a suspected source bug. The agent
 * declares a bug by ending the failing test's name with `(suspected bug:
 * <reason>)`; the validate gate derives `suspectedBugs` from this, so there is
 * no fragile cross-file JSON sync to keep byte-identical.
 */

// Anchored to end so only a trailing marker counts — `(safe default)` and
// mid-name mentions never false-trigger. Greedy capture handles parens in the
// reason; case-insensitive.
export const SUSPECTED_BUG_MARKER = /\(suspected bug:\s*(.+)\)\s*$/i;

/** Human-readable form the prompts instruct the agent to append. */
export const SUSPECTED_BUG_NAME_SUFFIX = "(suspected bug: <one-line reason>)";

/** Returns the trimmed reason from a marked test name, or null if unmarked. */
export function extractSuspectedBugRationale(testName: string): string | null {
  const match = testName.match(SUSPECTED_BUG_MARKER);
  if (!match?.[1]) return null;
  const rationale = match[1].trim();
  return rationale.length > 0 ? rationale : null;
}
