import type { SuspectedBug } from "../artifacts/agentOutput.js";
import type { DroppedFindingEntry } from "../review/droppedFindings.js";
import type { ReviewArtifact, ReviewFinding, ReviewSeverity } from "../review/index.js";

/**
 * Escape agent-controlled strings before interpolating into the PR body.
 *
 * The body contains literal HTML (`<details>` / `<summary>` for collapsible
 * severity buckets) which GitHub's markdown renderer expands. Reviewer output
 * (`finding.issue`, `finding.suggestion`, `finding.file`, `bug.rationale`,
 * etc.) is model-emitted text and may contain `<`/`>`/`&` — they need to
 * survive the HTML pass without being interpreted as tags. GitHub's own
 * sanitizer would strip dangerous tags, but escaping at the source kills
 * the SAST warning (CWE-116) and is defense-in-depth.
 *
 * Not applied to: severity enum values (literal union), numeric counts,
 * static markdown.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Aggregated cost/tokens across the three Claude invocations the pipeline
 * makes per run: the generation turn (`invoke-claude`), the primary +
 * adversarial reviewers (merged into `review.json`), and the optional
 * fix-turn. `open-pr` rolls all three into the PR body so the footprint
 * shown matches the real per-run spend, not just invoke-claude's number.
 */
export type PrBodyStats = {
  /**
   * `numTurns` from the invoke-claude session. The reviewer and fix-turn
   * session counts are intentionally not summed here — their "turns" are
   * a different concept (tool-call budget for a single short session), and
   * mixing them into one number would be misleading.
   */
  generationTurns?: number;
  /**
   * Total input tokens across all phases, including cache-read and
   * cache-creation tokens. The bare "input tokens" number the Anthropic
   * billing pipeline reports is usually tiny because nearly every token
   * is a cache-read; displaying only that number made the PR summary
   * read like "this used 31 input tokens" for a multi-minute run.
   */
  tokensIn: number;
  tokensOut: number;
  totalCostUsd: number;
  /**
   * Optional per-phase cost breakdown. When present, appended to the
   * `Cost:` line so reviewers can see where the spend went.
   */
  costBreakdown?: {
    generation?: number;
    review?: number;
    fixTurn?: number;
  };
};

/** One source file covered by this run, with its before/after coverage + mutation. */
export type PrBodyTarget = {
  relativeFilePath: string;
  coverageBefore: { line: number; branch: number };
  coverageAfter: { line: number; branch: number };
  mutationBefore: number | null;
  mutationAfter: number | null;
};

export type PrBodyInput = {
  packageName: string;
  /**
   * One entry per source file shipped in this PR. Always non-empty. N=1
   * renders identically to the pre-batching PR body (single coverage table,
   * singular "Target:" line); N>1 emits one coverage table per target under
   * a "Targets" section.
   */
  targets: PrBodyTarget[];
  stats: PrBodyStats;
  workflowRunUrl: string;
  /** Optional — when a reviewer ran, include a findings section. */
  review?: ReviewArtifact;
  /**
   * Optional — suspected-bug entries surfaced for human triage. When
   * populated, the PR ships with red CI: each entry corresponds to a bare
   * failing `test(...)` in the diff whose assertion describes correct
   * behavior the source does not satisfy. Merge is blocked by the failing
   * check until the source is fixed.
   */
  suspectedBugs?: SuspectedBug[];
  /**
   * Optional — tests the reviewer flagged blocking and fix-turn couldn't
   * repair. These are NOT shipped in the PR; surfaced here so the human
   * reviewer can see what the agent attempted and why it was dropped.
   */
  droppedTests?: DroppedFindingEntry[];
};

function formatPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

function formatMutation(m: number | null): string {
  return m === null ? "—" : formatPct(m);
}

function formatDelta(before: number, after: number): string {
  const delta = after - before;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}`;
}

function formatMutationDelta(before: number | null, after: number | null): string {
  if (before === null || after === null) return "—";
  return formatDelta(before, after);
}

const SEVERITIES_IN_ORDER: ReviewSeverity[] = ["critical", "high", "medium", "low", "info"];

function renderStatsLines(stats: PrBodyStats): string[] {
  const lines: string[] = [];
  if (stats.generationTurns !== undefined) {
    lines.push(`- Generation turns: ${stats.generationTurns}`);
  }
  // "incl. cache" label signals that the input count is the real footprint
  // (input + cache-read + cache-create), not just bare inputTokens — the
  // latter is tiny on cached sessions and reading "Tokens: in 31" on a
  // multi-minute run made the PR body look broken.
  lines.push(
    `- Tokens (incl. cache): in ${stats.tokensIn.toLocaleString()} / out ${stats.tokensOut.toLocaleString()}`,
  );
  const breakdown = stats.costBreakdown;
  const breakdownParts: string[] = [];
  if (breakdown?.generation !== undefined) {
    breakdownParts.push(`generation $${breakdown.generation.toFixed(4)}`);
  }
  if (breakdown?.review !== undefined) {
    breakdownParts.push(`review $${breakdown.review.toFixed(4)}`);
  }
  if (breakdown?.fixTurn !== undefined) {
    breakdownParts.push(`fix-turn $${breakdown.fixTurn.toFixed(4)}`);
  }
  const breakdownSuffix = breakdownParts.length > 0 ? ` (${breakdownParts.join(" + ")})` : "";
  lines.push(`- Cost: $${stats.totalCostUsd.toFixed(4)}${breakdownSuffix}`);
  return lines;
}

function renderFinding(f: ReviewFinding): string {
  const where = f.line ? `${escapeHtml(f.file)}:${f.line}` : escapeHtml(f.file);
  const suggestion = f.suggestion ? ` _Suggest: ${escapeHtml(f.suggestion)}_` : "";
  return `- \`${where}\` — ${escapeHtml(f.issue)}${suggestion}`;
}

function renderReviewSection(review: ReviewArtifact): string[] {
  const counts = new Map<ReviewSeverity, number>();
  for (const f of review.findings) {
    counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  }
  const countLine = SEVERITIES_IN_ORDER.map((sev) => `${counts.get(sev) ?? 0} ${sev}`).join(", ");

  const lines: string[] = [];
  lines.push("## Reviewer findings", "");
  lines.push(`_${countLine}._ ${review.summary ? escapeHtml(review.summary) : ""}`.trim(), "");

  for (const sev of SEVERITIES_IN_ORDER) {
    const subset = review.findings.filter((f) => f.severity === sev);
    if (subset.length === 0) continue;
    const collapsible = sev === "medium" || sev === "low" || sev === "info";
    const header = `${sev} (${subset.length})`;
    if (collapsible) {
      lines.push("<details>", `<summary>${escapeHtml(header)}</summary>`, "");
      lines.push(...subset.map(renderFinding));
      lines.push("", "</details>", "");
    } else {
      lines.push(`### ${header}`, "");
      lines.push(...subset.map(renderFinding));
      lines.push("");
    }
  }
  return lines;
}

function renderTargetCoverageTable(target: PrBodyTarget): string[] {
  return [
    "| Metric | Before | After | Delta |",
    "|---|---|---|---|",
    `| Line coverage | ${formatPct(target.coverageBefore.line)} | ${formatPct(
      target.coverageAfter.line,
    )} | ${formatDelta(target.coverageBefore.line, target.coverageAfter.line)} |`,
    `| Branch coverage | ${formatPct(target.coverageBefore.branch)} | ${formatPct(
      target.coverageAfter.branch,
    )} | ${formatDelta(target.coverageBefore.branch, target.coverageAfter.branch)} |`,
    `| Mutation score | ${formatMutation(target.mutationBefore)} | ${formatMutation(
      target.mutationAfter,
    )} | ${formatMutationDelta(target.mutationBefore, target.mutationAfter)} |`,
  ];
}

export function renderPrBody(input: PrBodyInput): string {
  if (input.targets.length === 0) {
    throw new Error("renderPrBody: targets[] must be non-empty");
  }
  const body: string[] = ["## Coverage Agent Run", ""];

  if (input.targets.length === 1) {
    const [only] = input.targets;
    if (!only) throw new Error("unreachable: checked length === 1 above");
    body.push(
      `**Target:** \`${escapeHtml(only.relativeFilePath)}\` (${escapeHtml(input.packageName)})`,
      "",
    );
    body.push(...renderTargetCoverageTable(only));
    body.push("");
  } else {
    body.push(
      `**Package:** \`${escapeHtml(input.packageName)}\` — covering ${input.targets.length} files in one run`,
      "",
    );
    for (const target of input.targets) {
      body.push(`### \`${escapeHtml(target.relativeFilePath)}\``, "");
      body.push(...renderTargetCoverageTable(target));
      body.push("");
    }
  }

  body.push(...renderStatsLines(input.stats), `- Run: ${input.workflowRunUrl}`, "");

  // Dropped tests (if any) appear BEFORE the reviewer-findings section so
  // readers see "what didn't ship" before "what did" — keeps the top of the
  // PR honest about partial/record-only runs.
  if (input.droppedTests && input.droppedTests.length > 0) {
    body.push(...renderDroppedSection(input.droppedTests));
  }

  if (input.review) {
    body.push(...renderReviewSection(input.review));
  }

  if (input.suspectedBugs && input.suspectedBugs.length > 0) {
    body.push(...renderSuspectedBugsSection(input.suspectedBugs));
  }

  body.push(
    "Generated by `.github/workflows/coverage-agent.yml`. No source files modified beyond `export`-keyword additions (diff gate enforced). Review normally.",
    "",
  );
  return body.join("\n");
}

function renderSuspectedBugsSection(bugs: SuspectedBug[]): string[] {
  const lines: string[] = [];
  lines.push("## Suspected bugs found (CI is RED by design)", "");
  const header =
    bugs.length === 1
      ? "This PR ships 1 bare failing `test(...)` whose assertion describes what the source SHOULD do. **CI is red on purpose** — merge is blocked by the failing check until the source is fixed. Once the source is fixed the test will pass with no test changes needed."
      : `This PR ships ${bugs.length} bare failing \`test(...)\` cases whose assertions describe what the source SHOULD do. **CI is red on purpose** — merge is blocked by the failing check until the source is fixed. Once each source bug is fixed its test will pass with no test changes needed.`;
  lines.push(header, "");
  for (const b of bugs) {
    const testFile = b.testRepoRel.split("/").pop() ?? b.testRepoRel;
    lines.push(
      `- [ ] \`${escapeHtml(testFile)}::${escapeHtml(b.testName)}\` — _${escapeHtml(b.rationale)}_`,
    );
  }
  lines.push(
    "",
    "Do NOT convert these to `test.fails()`, `.skip()`, or delete them to unblock merge — the anti-pattern lint gate rejects `.fails()`, and deletion erases the signal. Fix the source instead.",
    "",
  );
  return lines;
}

function renderDroppedSection(dropped: DroppedFindingEntry[]): string[] {
  const lines: string[] = [];
  const totalFindings = dropped.reduce((acc, d) => acc + d.findings.length, 0);
  lines.push("## Tests dropped by reviewer", "");
  lines.push(
    `The coverage agent generated ${dropped.length} test file(s), but the reviewer flagged ` +
      `${totalFindings} blocking issue(s) that fix-turn could not repair. The offending ` +
      "`test(...)` / `it(...)` blocks were spliced out of the file — sibling tests that " +
      "reviewed cleanly still ship. If splicing would have left zero tests, the whole file " +
      "was unlinked and a drop-marker was committed so a `Quarantine-File:` trailer prevents " +
      "future runs from re-selecting the target.",
    "",
  );
  for (const entry of dropped) {
    lines.push(`### \`${escapeHtml(entry.testRepoRel)}\``, "");
    for (const sev of SEVERITIES_IN_ORDER) {
      const subset = entry.findings.filter((f) => f.severity === sev);
      if (subset.length === 0) continue;
      lines.push(`**${sev} (${subset.length})**`, "");
      lines.push(...subset.map(renderFinding));
      lines.push("");
    }
  }
  return lines;
}

export function renderPrTitle(
  packageName: string,
  target: string | readonly string[],
  options: { droppedOnly?: boolean } = {},
): string {
  const targets = typeof target === "string" ? [target] : [...target];
  if (targets.length === 0) {
    throw new Error("renderPrTitle: target list must be non-empty");
  }
  const isBatch = targets.length > 1;
  if (options.droppedOnly) {
    if (isBatch) {
      return `test(${packageName}): record reviewer-dropped coverage attempt for ${targets.length} files`;
    }
    return `test(${packageName}): record reviewer-dropped coverage attempt for ${targets[0]}`;
  }
  if (isBatch) {
    return `test(${packageName}): add coverage for ${targets.length} files`;
  }
  return `test(${packageName}): add coverage for ${targets[0]}`;
}
