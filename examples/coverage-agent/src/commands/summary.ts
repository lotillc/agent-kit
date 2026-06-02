import { appendFileSync } from "node:fs";
import { readOptionalJson } from "../artifacts/optional.js";
import type { CoverageAgentConfig } from "../config.js";
import { loadConfig } from "../config.js";

/**
 * Render a human-readable markdown summary of the last run into
 * $GITHUB_STEP_SUMMARY (in CI) or stdout (locally). Mirrors what the old
 * bash heredoc in .github/workflows/coverage-agent.yml produced, without
 * any shell.
 */
export function runSummary(config: CoverageAgentConfig = loadConfig()): number {
  const runRecord = readOptionalJson(config.runRecordPath);
  const claudeStats = readOptionalJson(config.claudeStatsPath);

  // Nothing to summarize — match the workflow's `if-no-files-found: ignore`.
  if (!runRecord && !claudeStats) return 0;

  const lines: string[] = ["## Coverage Agent Run", ""];
  if (runRecord) {
    lines.push("### Run record", "```json", JSON.stringify(runRecord, null, 2), "```", "");
  }
  if (claudeStats) {
    lines.push("### Claude stats", "```json", JSON.stringify(claudeStats, null, 2), "```", "");
  }
  const markdown = `${lines.join("\n")}\n`;

  const target = process.env.GITHUB_STEP_SUMMARY;
  if (target) {
    appendFileSync(target, markdown, "utf8");
  } else {
    process.stdout.write(markdown);
  }
  return 0;
}
