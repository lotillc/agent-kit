import { z } from "zod";

import type { SpawnFn } from "../../ports/SpawnFn.js";
import { defaultSpawn } from "../process/defaultSpawn.js";

/**
 * `gh pr list --json …` wrapper. Consumers pass a label filter and receive a
 * list of open PRs with enough metadata to pick a stack base.
 *
 * Silent failure semantics: when `gh` is missing or not authenticated the
 * function returns `[]` rather than throwing, so agents can proceed with a
 * fallback base branch.
 */

export const OpenPrSchema = z.strictObject({
  number: z.number().int(),
  headRefName: z.string(),
  headRefOid: z.string(),
  baseRefName: z.string(),
  createdAt: z.string().optional(),
});

export type OpenPr = z.infer<typeof OpenPrSchema>;

const OpenPrListSchema = z.array(OpenPrSchema);

export interface ListOpenPrsInput {
  /** Working directory with `gh` auth context. */
  cwd: string;
  /** Label filter (required). Use the brand of the agent. */
  label: string;
  /** Max results to return. Default 50. */
  limit?: number;
  spawn?: SpawnFn;
}

export const listOpenPrs = ({
  cwd,
  label,
  limit = 50,
  spawn = defaultSpawn,
}: ListOpenPrsInput): OpenPr[] => {
  const res = spawn(
    "gh",
    [
      "pr",
      "list",
      "--label",
      label,
      "--state",
      "open",
      "--json",
      "number,headRefName,headRefOid,baseRefName,createdAt",
      "--limit",
      String(limit),
    ],
    { cwd },
  );
  if (res.exitCode !== 0) return [];
  try {
    const parsed = OpenPrListSchema.parse(JSON.parse(res.stdout));
    return parsed;
  } catch {
    return [];
  }
};
