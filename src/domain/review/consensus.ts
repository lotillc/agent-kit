import type { ModelRunner, ModelRunResult, RunCostContext } from "../../ports/ModelRunner.js";
import { compareSeverity, normalizeSeverity, type Severity } from "./severity.js";

/**
 * Multi-model review with Star-Chamber-style consensus. Each runner reviews
 * the same prompt in parallel; findings are aggregated by (file, description)
 * similarity; each gets a consensus tier (unanimous | majority | single).
 *
 * Split into:
 *
 *   - `multiModelReview` — orchestrates the parallel run + aggregation
 *   - `parseFindingsFromOutput` — extracts findings from a runner's raw output
 *   - `aggregateFindings` — pure consensus computation over model outputs
 */

export type ConsensusTier = "unanimous" | "majority" | "single";

export interface ReviewFinding {
  id: string;
  filePath: string;
  line?: number;
  severity: Severity;
  description: string;
  suggestion?: string;
  flaggedBy: string[];
  consensus: ConsensusTier;
  autoFixable: boolean;
}

export interface ModelReviewOutput {
  model: string;
  findings: ReadonlyArray<Omit<ReviewFinding, "flaggedBy" | "consensus" | "id">>;
  success: boolean;
  error?: string;
  costUsd?: number;
  durationMs?: number;
}

export interface ReviewArtifact {
  runId: string;
  prNumber?: number;
  modelOutputs: ReadonlyArray<ModelReviewOutput>;
  findings: ReadonlyArray<ReviewFinding>;
  stats: {
    totalFindings: number;
    unanimousFindings: number;
    majorityFindings: number;
    singleFindings: number;
    autoFixableCount: number;
    totalCostUsd: number;
    totalDurationMs: number;
  };
}

export interface MultiModelReviewInput {
  runners: ReadonlyArray<ModelRunner>;
  prompt: string;
  workingDir: string;
  runId: string;
  /** Per-runner timeout in ms. Default 2 minutes. */
  timeoutMs?: number;
  /** Correlation stamped onto every runner's `CostEvent` (e.g. `{ correlationId: runId }`). */
  costContext?: RunCostContext;
}

const DEFAULT_REVIEW_TIMEOUT_MS = 2 * 60 * 1000;

export const multiModelReview = async ({
  runners,
  prompt,
  workingDir,
  runId,
  timeoutMs = DEFAULT_REVIEW_TIMEOUT_MS,
  costContext,
}: MultiModelReviewInput): Promise<ReviewArtifact> => {
  if (runners.length === 0) {
    return emptyArtifact(runId);
  }

  // Preallocate so results land at the runner's input index — `modelOutputs`
  // order is deterministic regardless of which runner finishes first.
  const outputs: ModelReviewOutput[] = new Array(runners.length);
  await Promise.all(
    runners.map(async (runner, index) => {
      const started = Date.now();
      const controller = new AbortController();
      try {
        const result = await withTimeout(
          (signal) => runner.runReview(prompt, workingDir, signal, costContext),
          timeoutMs,
          controller,
        );
        outputs[index] = resultToModelOutput(runner.name, result, Date.now() - started);
      } catch (err) {
        outputs[index] = {
          model: runner.name,
          findings: [],
          success: false,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - started,
        };
      }
    }),
  );

  return aggregateFindings(runId, outputs, runners.length);
};

const resultToModelOutput = (
  model: string,
  result: ModelRunResult,
  durationMs: number,
): ModelReviewOutput => ({
  model,
  findings: result.success ? parseFindingsFromOutput(result.rawOutput) : [],
  success: result.success,
  error: result.success ? undefined : result.error,
  costUsd: result.costUsd,
  durationMs,
});

/**
 * Extract findings from a runner's raw output. Tries JSON array / JSON object,
 * falling back to a single "text" finding. Exported for testing.
 */
export const parseFindingsFromOutput = (
  raw: string,
): Array<Omit<ReviewFinding, "flaggedBy" | "consensus" | "id">> => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const array = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "findings" in parsed
        ? ((parsed as { findings: unknown }).findings as unknown[])
        : null;
    if (!array) return [];
    return array.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const raw = item as Record<string, unknown>;
      const filePath =
        typeof raw.filePath === "string"
          ? raw.filePath
          : typeof raw.file === "string"
            ? raw.file
            : undefined;
      const description =
        typeof raw.description === "string"
          ? raw.description
          : typeof raw.issue === "string"
            ? raw.issue
            : undefined;
      if (!filePath || !description) return [];
      return [
        {
          filePath,
          line: typeof raw.line === "number" ? raw.line : undefined,
          severity: normalizeSeverity(typeof raw.severity === "string" ? raw.severity : "low"),
          description,
          suggestion: typeof raw.suggestion === "string" ? raw.suggestion : undefined,
          autoFixable: raw.autoFixable === true,
        },
      ];
    });
  } catch {
    return [];
  }
};

/**
 * Aggregate per-model findings into a `ReviewArtifact` with consensus tiers.
 * Exported for testing independent of a real runner fleet.
 */
export const aggregateFindings = (
  runId: string,
  modelOutputs: ReadonlyArray<ModelReviewOutput>,
  totalModels: number,
): ReviewArtifact => {
  const groups = new Map<
    string,
    { sample: ModelReviewOutput["findings"][number]; flaggedBy: Set<string> }
  >();

  for (const output of modelOutputs) {
    if (!output.success) continue;
    for (const finding of output.findings) {
      // Key on the FULL normalized description (not a 100-char prefix) so
      // distinct findings whose first 100 chars happen to align — common with
      // templated phrasing across models — stay separate. We collapse internal
      // whitespace so models that wrap text at different widths still merge.
      const normalized = finding.description.trim().replace(/\s+/g, " ");
      const key = `${finding.filePath}::${normalized}`;
      const existing = groups.get(key);
      if (existing) {
        existing.flaggedBy.add(output.model);
        // Escalate to the highest severity reported across all flagging models.
        // If model A says "critical" and B says "low" for the same finding, the
        // merged finding is "critical" — least surprising for consumers acting
        // on the output (always conservative, never demotes urgency).
        if (compareSeverity(finding.severity, existing.sample.severity) < 0) {
          existing.sample = { ...existing.sample, severity: finding.severity };
        }
      } else {
        groups.set(key, { sample: finding, flaggedBy: new Set([output.model]) });
      }
    }
  }

  const findings: ReviewFinding[] = [];
  let i = 0;
  for (const [, group] of groups) {
    const flagged = group.flaggedBy.size;
    const consensus: ConsensusTier =
      flagged === totalModels ? "unanimous" : flagged > totalModels / 2 ? "majority" : "single";
    findings.push({
      id: `f${String(i++).padStart(3, "0")}`,
      filePath: group.sample.filePath,
      line: group.sample.line,
      severity: group.sample.severity,
      description: group.sample.description,
      suggestion: group.sample.suggestion,
      flaggedBy: [...group.flaggedBy].sort(),
      consensus,
      autoFixable: group.sample.autoFixable,
    });
  }

  findings.sort((a, b) => {
    const s = compareSeverity(a.severity, b.severity);
    if (s !== 0) return s;
    return consensusOrder(a.consensus) - consensusOrder(b.consensus);
  });

  const unanimousFindings = findings.filter((f) => f.consensus === "unanimous").length;
  const majorityFindings = findings.filter((f) => f.consensus === "majority").length;
  const singleFindings = findings.filter((f) => f.consensus === "single").length;
  const autoFixableCount = findings.filter((f) => f.autoFixable).length;

  return {
    runId,
    modelOutputs,
    findings,
    stats: {
      totalFindings: findings.length,
      unanimousFindings,
      majorityFindings,
      singleFindings,
      autoFixableCount,
      totalCostUsd: modelOutputs.reduce((acc, o) => acc + (o.costUsd ?? 0), 0),
      totalDurationMs: modelOutputs.reduce((acc, o) => acc + (o.durationMs ?? 0), 0),
    },
  };
};

const consensusOrder = (c: ConsensusTier): number =>
  c === "unanimous" ? 0 : c === "majority" ? 1 : 2;

/**
 * Race a runner against a deadline, aborting the runner's signal on timeout so
 * the underlying process is killed instead of left running (and billing).
 */
const withTimeout = <T>(
  start: (signal: AbortSignal) => Promise<T>,
  ms: number,
  controller: AbortController,
): Promise<T> => {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((_, reject) => {
    timerId = setTimeout(() => {
      controller.abort();
      reject(new Error(`runner timed out after ${ms}ms`));
    }, ms);
  });
  // Clear the deadline timer once either side settles so the rejection branch
  // doesn't fire on an already-settled promise (unhandled rejection on Node 24).
  // Swallow a late rejection if the deadline wins the race — a custom runner
  // that rejects (rather than resolves) on abort would otherwise surface an
  // unhandled rejection after we've already moved on.
  const runnerPromise = start(controller.signal);
  runnerPromise.catch(() => undefined);
  return Promise.race([runnerPromise, deadline]).finally(() => {
    if (timerId !== undefined) clearTimeout(timerId);
  });
};

const emptyArtifact = (runId: string): ReviewArtifact => ({
  runId,
  modelOutputs: [],
  findings: [],
  stats: {
    totalFindings: 0,
    unanimousFindings: 0,
    majorityFindings: 0,
    singleFindings: 0,
    autoFixableCount: 0,
    totalCostUsd: 0,
    totalDurationMs: 0,
  },
});
