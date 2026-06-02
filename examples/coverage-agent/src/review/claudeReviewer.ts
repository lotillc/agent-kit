import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { type AuthMode, runAgenticClaude } from "@lotiai/agent-kit/agent-cli/claude";
import type { Reviewer, ReviewInput } from "@lotiai/agent-kit/ports";

import {
  ADVERSARIAL_REVIEW_JSON_BASENAME,
  buildAdversarialReviewerPrompt,
} from "./buildAdversarialReviewerPrompt.js";
import { buildReviewerPrompt } from "./buildReviewerPrompt.js";
import { type ReviewArtifact, ReviewArtifactSchema } from "./reviewer.js";

export interface ClaudeReviewerOptions {
  /** Override the model used by the reviewer session. */
  model?: string;
  /** Timeout in ms. Defaults to 10 min. */
  timeoutMs?: number;
  /**
   * When true, use the red-team 2nd-pass prompt and write to
   * `review.adversarial.json`. The adversarial pass now runs concurrently
   * with the primary; dedupe and severity-max-wins happen at merge time
   * (`mergeReviewArtifacts`), so prior-findings no longer thread into the
   * prompt.
   */
  adversarial?: boolean;
  /**
   * Anthropic API key. Captured at construction (adapter concern, per
   * agent-kit's `ReviewInput` port — auth doesn't belong in the domain input).
   * Omit under `auth: "oauth"` to use the cached OAuth session.
   */
  apiKey?: string;
  /**
   * Auth mode forwarded to `runAgenticClaude`. Default `"auto"`: bare if
   * `apiKey` is supplied, otherwise OAuth. Pass `"bare"` to force the bare
   * `--bare` mode even when no key is set (the CLI will error loudly, which is
   * the safer default than silently inheriting an ambient env key).
   */
  auth?: AuthMode;
}

const DEFAULT_REVIEWER_TIMEOUT_MS = 10 * 60 * 1000;
const PRIMARY_REVIEW_JSON_BASENAME = "review.json";

/**
 * Concrete Reviewer that spawns `@lotiai/agent-kit`'s Claude Code runner
 * against the coverage-specific prompt in `buildReviewerPrompt` (primary
 * mode) or `buildAdversarialReviewerPrompt` (2nd-pass red-team mode).
 */
export class ClaudeReviewer implements Reviewer {
  readonly name: string;
  constructor(private readonly opts: ClaudeReviewerOptions = {}) {
    this.name = opts.adversarial ? "claude-adversarial" : "claude";
  }

  async review(input: ReviewInput): Promise<ReviewArtifact> {
    const prompt = this.opts.adversarial
      ? buildAdversarialReviewerPrompt(input)
      : buildReviewerPrompt(input);
    const result = await runAgenticClaude(prompt, input.workingDir, {
      apiKey: this.opts.apiKey,
      maxTurns: input.maxTurns,
      timeoutMs: this.opts.timeoutMs ?? DEFAULT_REVIEWER_TIMEOUT_MS,
      model: this.opts.model,
      auth: this.opts.auth ?? "auto",
      // Opt in explicitly: agent-kit defaults skip-permissions off (ADR-0022).
      dangerouslySkipPermissions: true,
    });

    const durationMs = result.stats?.durationMs ?? result.durationMs;
    const totalCostUsd = result.stats?.totalCostUsd;
    const inputTokens = result.stats?.inputTokens;
    const outputTokens = result.stats?.outputTokens;
    const cacheReadTokens = result.stats?.cacheReadTokens;
    const cacheCreationTokens = result.stats?.cacheCreationTokens;
    const outputBasename = this.opts.adversarial
      ? ADVERSARIAL_REVIEW_JSON_BASENAME
      : PRIMARY_REVIEW_JSON_BASENAME;
    const reviewJsonPath = resolve(input.workingDir, ".coverage-agent-run", outputBasename);

    const statFields = {
      durationMs,
      totalCostUsd,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
    };

    if (!existsSync(reviewJsonPath)) {
      return {
        reviewerName: this.name,
        ...statFields,
        findings: [],
        summary: `reviewer did not produce ${outputBasename}`,
      };
    }

    try {
      const raw = JSON.parse(readFileSync(reviewJsonPath, "utf8")) as Record<string, unknown>;
      const parsed = ReviewArtifactSchema.safeParse({
        ...raw,
        reviewerName: this.name,
        ...statFields,
      });
      if (!parsed.success) {
        return {
          reviewerName: this.name,
          ...statFields,
          findings: [],
          summary: `reviewer output failed schema: ${parsed.error.message.slice(0, 200)}`,
        };
      }
      return parsed.data;
    } catch (err) {
      return {
        reviewerName: this.name,
        ...statFields,
        findings: [],
        summary: `reviewer output not parseable: ${(err as Error).message.slice(0, 200)}`,
      };
    }
  }
}
