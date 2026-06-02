import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

export const SelectionTargetSchema = z.strictObject({
  absoluteFilePath: z.string(),
  relativeFilePath: z.string(),
  repoRelativeFilePath: z.string(),
  uncoveredLines: z.number().int().nonnegative(),
  totalLines: z.number().int().nonnegative(),
  coverageBefore: z.strictObject({
    line: z.number(),
    branch: z.number(),
  }),
});
export type SelectionTarget = z.infer<typeof SelectionTargetSchema>;

export const SelectionArtifactSchema = z.strictObject({
  packageName: z.string(),
  packageDir: z.string(),
  // targets[] in priority order. When N=1 this equals [primary]; when N>1
  // (step 8 onwards) each entry gets its own test file.
  targets: z.array(SelectionTargetSchema).min(1),
  exemplarTestPaths: z.array(z.string()),
  locBudget: z.number().int().positive(),
  // Legacy top-level fields — mirror targets[0] so existing consumers keep
  // working without immediate changes. Downstream commands read `targets`
  // directly once they've been migrated.
  absoluteFilePath: z.string(),
  relativeFilePath: z.string(),
  repoRelativeFilePath: z.string(),
  uncoveredLines: z.number().int().nonnegative(),
  totalLines: z.number().int().nonnegative(),
  coverageBefore: z.strictObject({
    line: z.number(),
    branch: z.number(),
  }),
});

export type SelectionArtifact = z.infer<typeof SelectionArtifactSchema>;

export function readSelection(path: string): SelectionArtifact {
  return SelectionArtifactSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function writeSelection(path: string, value: SelectionArtifact): void {
  const validated = SelectionArtifactSchema.parse(value);
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}
