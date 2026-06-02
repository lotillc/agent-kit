import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

/**
 * Coverage-agent's review artifact schema. Structurally compatible with the
 * `ReviewerArtifact` port from `@lotiai/agent-kit/ports`; we keep the Zod
 * schema locally because we persist these artifacts to disk with coverage-
 * specific per-file validation semantics.
 */
export const ReviewSeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export type ReviewSeverity = z.infer<typeof ReviewSeveritySchema>;

export const ReviewFindingSchema = z.strictObject({
  file: z.string(),
  line: z.number().int().positive().optional(),
  severity: ReviewSeveritySchema,
  issue: z.string(),
  suggestion: z.string().optional(),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const ReviewArtifactSchema = z.strictObject({
  reviewerName: z.string(),
  durationMs: z.number().nonnegative(),
  totalCostUsd: z.number().nonnegative().optional(),
  // Token counts from the reviewer session. Optional because older artifacts
  // (pre-PR #2980) don't carry them, and because `runAgenticClaude` returns
  // stats optionally too. Aggregated at merge time (sum across reviewers) so
  // open-pr can roll them into the PR body alongside invoke-claude + fix-turn.
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheCreationTokens: z.number().int().nonnegative().optional(),
  findings: z.array(ReviewFindingSchema),
  summary: z.string().optional(),
});
export type ReviewArtifact = z.infer<typeof ReviewArtifactSchema>;

export function readReviewArtifact(path: string): ReviewArtifact {
  return ReviewArtifactSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function writeReviewArtifact(path: string, value: ReviewArtifact): void {
  const validated = ReviewArtifactSchema.parse(value);
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}

/**
 * Severity ordering used by `mergeReviewArtifacts` to collapse duplicate
 * findings: `critical > high > medium > low > info`. Single source of truth
 * so `blockingFindings` and the merge severity-max-wins logic can't drift.
 */
const SEVERITY_RANK: Record<ReviewSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

function maxSeverity(a: ReviewSeverity, b: ReviewSeverity): ReviewSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function normalizeIssue(issue: string): string {
  return issue.toLowerCase().replace(/\s+/g, " ").trim();
}

function dedupeKey(f: ReviewFinding): string {
  return `${f.file}::${f.line ?? -1}::${normalizeIssue(f.issue)}`;
}

/**
 * Merge findings from multiple reviewers into a single artifact with
 * dedupe + severity-max-wins semantics.
 *
 * When two findings collide on `(file, line, normalizedIssue)` we keep one
 * entry and take `max(severity)`. Later artifacts in the array win on
 * wording ties — this matches how the adversarial reviewer is meant to
 * *upgrade* a primary finding's severity at the same file+line (the
 * adversarial prompt explicitly invites this, and `commands/review.ts`
 * pushes the adversarial artifact after the primary).
 *
 * For distinct findings (different file/line/issue), this degenerates to
 * the previous behavior of simple concatenation. For consensus tiers
 * (unanimous / majority / single), consumers can still switch to
 * `multiModelReview` from `@lotiai/agent-kit/review`.
 */
export function mergeReviewArtifacts(artifacts: ReviewArtifact[]): ReviewArtifact {
  if (artifacts.length === 0) {
    return {
      reviewerName: "none",
      durationMs: 0,
      findings: [],
      summary: "no reviewers configured",
    };
  }
  if (artifacts.length === 1) {
    const single = artifacts[0];
    if (!single) throw new Error("unreachable: length 1");
    return single;
  }

  // Build an ordered dedupe map. Iterating in array order means later
  // artifacts (e.g. the adversarial reviewer, pushed after the primary)
  // win on wording/suggestion/line when issues match. Severity always
  // takes max, regardless of order.
  const byKey = new Map<string, ReviewFinding>();
  const order: string[] = [];
  for (const a of artifacts) {
    for (const f of a.findings) {
      const key = dedupeKey(f);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...f });
        order.push(key);
        continue;
      }
      byKey.set(key, {
        ...f,
        severity: maxSeverity(existing.severity, f.severity),
      });
    }
  }
  const mergedFindings = order.map((k) => {
    const f = byKey.get(k);
    if (!f) throw new Error("unreachable: dedupe key missing from map");
    return f;
  });

  const totalCost = artifacts.reduce((s, a) => s + (a.totalCostUsd ?? 0), 0);
  // Sum token fields across reviewers. `undefined` when no reviewer reported
  // the field (treat as "missing", not "zero") so the PR-body aggregator can
  // distinguish absent telemetry from a legitimate zero.
  const sumField = (
    key: keyof Pick<
      ReviewArtifact,
      "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheCreationTokens"
    >,
  ): number | undefined => {
    const values = artifacts.map((a) => a[key]).filter((v): v is number => typeof v === "number");
    if (values.length === 0) return undefined;
    return values.reduce((s, v) => s + v, 0);
  };
  return {
    reviewerName: artifacts.map((a) => a.reviewerName).join(","),
    durationMs: artifacts.reduce((s, a) => s + a.durationMs, 0),
    totalCostUsd: totalCost > 0 ? totalCost : undefined,
    inputTokens: sumField("inputTokens"),
    outputTokens: sumField("outputTokens"),
    cacheReadTokens: sumField("cacheReadTokens"),
    cacheCreationTokens: sumField("cacheCreationTokens"),
    findings: mergedFindings,
    summary: artifacts.map((a) => `[${a.reviewerName}] ${a.summary ?? "(no summary)"}`).join("\n"),
  };
}
