import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

export const SuspectedBugSchema = z.strictObject({
  sourceRepoRel: z.string(),
  testRepoRel: z.string(),
  testName: z.string(),
  rationale: z.string(),
});
export type SuspectedBug = z.infer<typeof SuspectedBugSchema>;

// Claude's self-report, written by the model at the end of its run.
// See src/prompts/buildTestGenerationPrompt.ts for the protocol.
export const AgentOutputSchema = z.strictObject({
  status: z.enum(["success", "gave_up"]),
  filesCreated: z.array(z.string()).default([]),
  filesModified: z.array(z.string()).default([]),
  rationale: z.string(),
  /**
   * Bare failing `test(...)` entries the agent committed because it believes
   * the source has a bug. Each entry's `testName` must match a failing
   * test's title exactly — the validate gate uses this to distinguish
   * expected failures (red CI by design) from real regressions.
   * Surfaced in the PR body for human triage; excluded from the Stryker
   * mutation gate to avoid penalizing ourselves for catching bugs.
   *
   * This field replaced the earlier `test.fails()` contract. `test.fails()`
   * is now hard-forbidden by the anti-pattern lint gate — see
   * `prompts/suspectedBugContract.ts`.
   */
  suspectedBugs: z.array(SuspectedBugSchema).default([]),
});

export type AgentOutput = z.infer<typeof AgentOutputSchema>;

export function readAgentOutput(path: string): AgentOutput {
  return AgentOutputSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function writeAgentOutput(path: string, value: AgentOutput): void {
  const validated = AgentOutputSchema.parse(value);
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}
