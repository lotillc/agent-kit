import { validateWorkingTreeDiff } from "@lotiai/agent-kit/git";

import type { CoverageAgentConfig } from "../config.js";
import { loadConfig } from "../config.js";

// Source files the agent may touch — only to add `export` keywords to
// existing top-level declarations. Any `.ts` under a `src/` directory in one
// of the recognized workspace roots. Broad on purpose so second repos don't
// need to reconfigure; the failure mode of a missing root is "file treated
// as disallowed," which is safe.
const SOURCE_PATH_PATTERN =
  /^(packages|services|josu|infrastructure|tools|experimental)\/.+\/src\/.+\.ts$/;

export function runValidateDiff(config: CoverageAgentConfig = loadConfig()): number {
  const result = validateWorkingTreeDiff({
    cwd: config.workingTree,
    // HEAD = the commit the ephemeral worktree was checked out at, so the diff is exactly Claude's edits regardless of which branch the pipeline was invoked from.
    baseRef: "HEAD",
    testFilePatterns: config.testRunner.testFilePatterns,
    sourcePathPattern: SOURCE_PATH_PATTERN,
  });
  if (result.ok) {
    const changed = result.testFiles.length + result.exportOnlyEdits.length;
    process.stdout.write(`diff ok: ${changed} file(s) changed, all in allowed test paths\n`);
    return 0;
  }
  process.stderr.write("diff gate rejected agent output:\n");
  for (const f of result.disallowed) {
    process.stderr.write(`  disallowed: ${f}\n`);
  }
  return 1;
}
