import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

/**
 * On-disk stack base resolved at pipeline start. Written by `invoke-claude`
 * so `open-pr` declares the same base the worktree forked from; without
 * this, a newer `listOpenPrs` result can pick a base that isn't an ancestor
 * of the worktree HEAD, leaking unrelated commits into the PR diff.
 */
export const StackBaseArtifactSchema = z.strictObject({
  baseBranch: z.string(),
  baseRef: z.string(),
  baseSha: z.string(),
  isStacked: z.boolean(),
});

export type StackBaseArtifact = z.infer<typeof StackBaseArtifactSchema>;

export function readStackBase(path: string): StackBaseArtifact {
  return StackBaseArtifactSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function writeStackBase(path: string, value: StackBaseArtifact): void {
  const validated = StackBaseArtifactSchema.parse(value);
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}
