import { runAgenticClaude } from "@lotiai/agent-kit/agent-cli/claude";

import type { CoverageAgentConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { SUSPECTED_BUG_CONTRACT } from "../prompts/suspectedBugContract.js";
import type { ReviewFinding } from "../review/reviewer.js";

export interface FixTurnResult {
  success: boolean;
  durationMs: number;
  totalCostUsd?: number;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  errorMessage?: string;
}

export async function runFixTurn(
  findings: ReviewFinding[],
  config: CoverageAgentConfig = loadConfig(),
): Promise<FixTurnResult> {
  const prompt = buildFixPrompt(findings);
  const result = await runAgenticClaude(prompt, config.workingTree, {
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxTurns: config.fixMaxTurns,
    timeoutMs: 15 * 60 * 1000,
    model: config.claudeModel,
    auth: config.useBareAuth ? "bare" : "auto",
    // Opt in explicitly: agent-kit defaults skip-permissions off (ADR-0022).
    dangerouslySkipPermissions: true,
  });
  return {
    success: result.success,
    durationMs: result.stats?.durationMs ?? result.durationMs,
    totalCostUsd: result.stats?.totalCostUsd,
    numTurns: result.stats?.numTurns,
    inputTokens: result.stats?.inputTokens,
    outputTokens: result.stats?.outputTokens,
    cacheReadTokens: result.stats?.cacheReadTokens,
    cacheCreationTokens: result.stats?.cacheCreationTokens,
    errorMessage: result.errorMessage,
  };
}

export function buildFixPrompt(findings: ReviewFinding[]): string {
  const serialized = JSON.stringify(findings, null, 2);
  return `You are revising the test files you wrote in this session based on reviewer findings below.

## Hard rules
- Only address CRITICAL and HIGH severity findings.
- You may edit the test files you created (\`*.vitest.ts\` under \`__tests__/\`).
- You may NOT modify source files (the diff gate still applies).
- Do NOT run tests — the pipeline will re-validate.
- Declare a suspected source bug by naming the failing test \`... (suspected bug: <reason>)\` (see below) — editing \`.coverage-agent-run/agent-output.json\` is optional.
- \`test.fails()\` and \`it.fails()\` are FORBIDDEN. The anti-pattern lint gate rejects them. If a prior turn introduced one, rewrite it as a bare failing \`test(...)\` per the contract below.
- Conditional \`expect(...)\` is FORBIDDEN. The anti-pattern lint gate rejects \`expect\` inside \`if\`/\`else\`/\`switch\` control flow via \`vitest/no-conditional-expect\`. Split the branches into separate tests, or compute the value first and make one unconditional assertion.
- **Before saving any file, verify every identifier you reference is imported.** Vitest globals are DISABLED in this repo. If you add a \`test(...)\` call into a file that only imports \`{ describe, it, expect }\`, you MUST add \`test\` to that import — make the line read \`import { ..., test } from "vitest"\` — otherwise the whole file fails to load with \`ReferenceError: test is not defined\` and the pipeline aborts with \`aborted_quality\` on re-validate. Re-read the file's first few lines after your edit to confirm the import list is correct.

## If a finding says your test asserts buggy behavior as if it were correct

This is the single most common fixable case. Do **not** delete the test, weaken the assertion, mark it \`.skip\`, or wrap it with \`test.fails()\`. The right fix is to restore the correct-behavior assertion on a bare \`test(...)\` and **end its name with \`(suspected bug: <reason>)\`** — the test will fail under CI, which is the intended signal:

${SUSPECTED_BUG_CONTRACT}

The name marker alone declares the bug — you do NOT need to edit \`.coverage-agent-run/agent-output.json\` (the validate gate derives the declaration from the test name). A bare failing \`test(...)\` whose name carries the marker with a plausible reason is NOT flagged by the reviewer and is allowed through the validate gate.

## Findings to address

\`\`\`json
${serialized}
\`\`\`
`;
}
