/**
 * Port for diff-to-findings review. Concrete impl (ClaudeReviewer) arrives in PR 6.
 *
 * Auth + backend transport (api key, bare-vs-OAuth mode, base URL) belong on the
 * adapter's constructor, not on `ReviewInput` — the input describes *what* to
 * review, not *how* to authenticate. The full `ReviewArtifact` shape lives in
 * `domain/review/`; this port is just the call signature.
 */
export interface ReviewInput {
  diff: string;
  targets: ReadonlyArray<{ sourceRepoRel: string; testRepoRel: string }>;
  workingDir: string;
  maxTurns: number;
}

export interface Reviewer {
  readonly name: string;
  review(input: ReviewInput): Promise<ReviewerArtifact>;
}

/**
 * Single-reviewer output shape (one runner reviewing a diff). Distinct from
 * the richer `ReviewFinding` + `ReviewArtifact` types in `domain/review/`
 * which carry multi-model consensus metadata.
 */
export interface ReviewerArtifact {
  reviewerName: string;
  durationMs: number;
  totalCostUsd?: number;
  findings: ReadonlyArray<ReviewerFinding>;
  summary?: string;
}

export interface ReviewerFinding {
  file: string;
  line?: number;
  severity: "critical" | "high" | "medium" | "low" | "info";
  issue: string;
  suggestion?: string;
}
