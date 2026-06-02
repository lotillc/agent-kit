export interface QuarantineTrailer {
  sourceRepoRel: string;
  reason: string;
}

/**
 * Emit `Quarantine-File: <path> (<reason>)` trailer lines for the commit
 * message body. Empty input → empty string. Reason is truncated to 80 chars
 * and stripped of newlines + parens.
 */
export function buildQuarantineTrailers(entries: readonly QuarantineTrailer[]): string {
  if (entries.length === 0) return "";
  return entries
    .map((e) => {
      const reason = e.reason
        .replace(/[\r\n()]+/g, " ")
        .trim()
        .slice(0, 80);
      return `Quarantine-File: ${e.sourceRepoRel} (${reason})`;
    })
    .join("\n");
}
