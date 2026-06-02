import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

import { ReviewFindingSchema } from "./reviewer.js";

/**
 * On-disk record of the test files the reviewer blocked (after a failed
 * fix-turn) and the findings that blocked them. Written by the pipeline
 * after the downgrade step; consumed by `open-pr` so the resulting PR body
 * can surface what was dropped and why.
 *
 * Kept separate from `review.json` because:
 *  - `review.json` reflects the LAST review pass on the shipped test set
 *    (which, after drop, may be empty).
 *  - `dropped-findings.json` is the historical record of what the reviewer
 *    caught on files that didn't make it to the PR.
 */
export const DroppedFindingEntrySchema = z.strictObject({
  testRepoRel: z.string(),
  findings: z.array(ReviewFindingSchema),
});
export type DroppedFindingEntry = z.infer<typeof DroppedFindingEntrySchema>;

export const DroppedFindingsSchema = z.strictObject({
  entries: z.array(DroppedFindingEntrySchema),
});
export type DroppedFindings = z.infer<typeof DroppedFindingsSchema>;

export function readDroppedFindings(path: string): DroppedFindings {
  return DroppedFindingsSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function writeDroppedFindings(path: string, value: DroppedFindings): void {
  const validated = DroppedFindingsSchema.parse(value);
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}

/**
 * Tolerant reader used by `open-pr`: returns `undefined` when the file is
 * absent or malformed, so a partial/aborted pipeline can still open the PR.
 */
export function readDroppedFindingsIfExists(path: string): DroppedFindings | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return readDroppedFindings(path);
  } catch {
    return undefined;
  }
}
