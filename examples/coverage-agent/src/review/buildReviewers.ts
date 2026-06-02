import type { Reviewer } from "@lotiai/agent-kit/ports";

import type { CoverageAgentConfig } from "../config.js";

import { ClaudeReviewer } from "./claudeReviewer.js";

/**
 * Factory shape returned by `buildReviewers`. Primary and adversarial
 * (when enabled) run concurrently in `runReview` — the adversarial pass
 * no longer takes the primary's findings as input, since dedupe and
 * severity-max-wins are handled at merge time by `mergeReviewArtifacts`.
 */
export interface ReviewerFactory {
  primary: Reviewer;
  adversarial?: Reviewer;
}

/**
 * Construct the reviewer implementations listed in config.reviewerNames,
 * plus (when enabled) the adversarial 2nd-pass reviewer.
 *
 * v1 supports only `"claude"` as the primary. When multi-model consensus is
 * needed, consumers can swap to `multiModelReview` from `@lotiai/agent-kit/review`
 * (which takes a `ModelRunner[]`, not a `Reviewer[]`).
 *
 * The adversarial pass reuses the same `ClaudeReviewer` adapter in
 * `adversarial` mode — different prompt, separate output artifact path,
 * same model by default (see `config.adversarialReviewerModel` for an
 * override knob we haven't needed yet).
 */
export function buildReviewers(config: CoverageAgentConfig): ReviewerFactory {
  const names = config.reviewerNames;
  if (names.length === 0) {
    throw new Error("at least one reviewer must be configured (got empty reviewerNames)");
  }
  if (names.length > 1) {
    // Historic multi-reviewer loop is no longer used — the adversarial pass
    // is the one sanctioned way to run two reviewers. Fail loudly if someone
    // sets `COVERAGE_AGENT_REVIEWERS=claude,codex` expecting the old behavior.
    throw new Error(
      `multiple primary reviewers are not supported; got ${JSON.stringify(names)}. ` +
        "To add a 2nd pass, set enableAdversarialReview=true instead.",
    );
  }
  const primaryName = names[0];
  // Auth lives on the reviewer adapter (constructor), NOT on `ReviewInput` —
  // matches agent-kit's port shape (ADR rationale: domain input describes
  // *what* to review; transport/auth is *how to talk to the backend*).
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const auth = config.useBareAuth ? "bare" : "auto";
  let primary: Reviewer;
  switch (primaryName) {
    case "claude":
      primary = new ClaudeReviewer({ model: config.reviewerModel, apiKey, auth });
      break;
    default:
      throw new Error(`unknown reviewer: ${primaryName} (valid: claude; future: codex, gemini)`);
  }

  if (!config.enableAdversarialReview) {
    return { primary };
  }

  const adversarialModel = config.adversarialReviewerModel ?? config.reviewerModel;
  const adversarial: Reviewer = new ClaudeReviewer({
    model: adversarialModel,
    adversarial: true,
    apiKey,
    auth,
  });

  return { primary, adversarial };
}
