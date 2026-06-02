import { existsSync } from "node:fs";

import { defaultSpawn } from "@lotiai/agent-kit/process";

import { type AgentOutput, readAgentOutput } from "../artifacts/agentOutput.js";
import { readSelection } from "../artifacts/selection.js";
import type { CoverageAgentConfig } from "../config.js";
import { loadConfig } from "../config.js";
import {
  buildReviewers,
  mergeReviewArtifacts,
  type ReviewArtifact,
  writeReviewArtifact,
} from "../review/index.js";

export async function runReview(config: CoverageAgentConfig = loadConfig()): Promise<number> {
  if (!existsSync(config.selectionJsonPath)) {
    process.stderr.write(`[review] selection.json not found at ${config.selectionJsonPath}\n`);
    return 1;
  }
  if (!existsSync(config.agentOutputPath)) {
    process.stderr.write(`[review] agent-output.json not found at ${config.agentOutputPath}\n`);
    return 1;
  }

  const { primary, adversarial } = buildReviewers(config);
  const selection = readSelection(config.selectionJsonPath);
  const agentOutput = readAgentOutput(config.agentOutputPath);

  // Pair each generated test file with its source target. The agent's
  // convention is <pkg>/src/__tests__/<name>.vitest.ts for a source at
  // <pkg>/src/<name>.ts, so we match by stripped basename against
  // selection.targets. Unmatched test files fall back to the primary target
  // so the reviewer still sees *some* source — losing the pairing would
  // force the reviewer to blind-guess which source each test covers.
  const targetsBySourceBase = new Map<string, string>();
  for (const t of selection.targets) {
    // `<pkg>/src/foo.ts` → key `foo` (stripping .ts and the src/ prefix logic
    // is handled by the test-file regex below).
    const match = t.repoRelativeFilePath.match(/\/src\/(.+?)\.ts$/);
    const key = match?.[1] ?? t.repoRelativeFilePath;
    targetsBySourceBase.set(key, t.repoRelativeFilePath);
  }
  const primarySource =
    selection.targets[0]?.repoRelativeFilePath ?? selection.repoRelativeFilePath;
  const targets = [...agentOutput.filesCreated, ...agentOutput.filesModified].map((testRepoRel) => {
    const m = testRepoRel.match(/\/src\/__tests__\/(.+?)\.vitest\.ts$/);
    const key = m?.[1];
    const sourceRepoRel = (key ? targetsBySourceBase.get(key) : undefined) ?? primarySource;
    return { testRepoRel, sourceRepoRel };
  });

  const diff = getGeneratedFilesDiff(config, agentOutput);
  // `apiKey` + `auth` are captured at reviewer construction time
  // (see `buildReviewers` + `ClaudeReviewerOptions`); the domain `ReviewInput`
  // is intentionally auth-agnostic per agent-kit's port shape.
  const reviewInput = {
    diff,
    targets,
    workingDir: config.workingTree,
    maxTurns: config.reviewMaxTurns,
  };

  // Primary + adversarial run concurrently. Dedupe and severity-max-wins
  // are handled at merge time (mergeReviewArtifacts), so the adversarial
  // pass no longer needs the primary's findings threaded into its prompt.
  // Artifacts are pushed in primary-first order so later-wins-on-wording
  // in merge lets the adversarial's framing win on ties — matches the
  // prior sequential semantic. Promise.all is used (vs. sequential
  // awaits) so both rejection handlers are attached synchronously at
  // creation time — otherwise a fast adversarial failure could surface
  // as an unhandledRejection crash while the primary is still running
  // (Node 15+ default `--unhandled-rejections=throw`).
  process.stderr.write(`[review] invoking reviewer: ${primary.name}\n`);
  const primaryPromise = primary.review(reviewInput).then((result): ReviewArtifact => {
    const artifact: ReviewArtifact = { ...result, findings: [...result.findings] };
    process.stderr.write(`[review] primary returned ${artifact.findings.length} finding(s)\n`);
    return artifact;
  });

  const tasks: Promise<ReviewArtifact>[] = [primaryPromise];
  if (adversarial) {
    process.stderr.write(`[review] invoking reviewer: ${adversarial.name} (red-team)\n`);
    tasks.push(
      adversarial.review(reviewInput).then((result): ReviewArtifact => {
        const artifact: ReviewArtifact = { ...result, findings: [...result.findings] };
        process.stderr.write(
          `[review] adversarial returned ${artifact.findings.length} finding(s)\n`,
        );
        return artifact;
      }),
    );
  }

  const artifacts: ReviewArtifact[] = await Promise.all(tasks);

  const merged = mergeReviewArtifacts(artifacts);
  writeReviewArtifact(config.reviewPath, merged);
  process.stderr.write(
    `[review] wrote ${config.reviewPath} — ${merged.findings.length} merged finding(s)\n`,
  );
  return 0;
}

// Diff only the files the coverage agent actually created or modified, vs.
// the worktree's detach point (HEAD). Previously this diffed against
// `origin/${sandboxBranch}` which, for a stacked PR, bundled the entire
// PR scaffolding into the reviewer prompt — wasting tokens and confusing
// the reviewer into flagging code the agent never touched.
export function getGeneratedFilesDiff(
  config: CoverageAgentConfig,
  agentOutput: AgentOutput,
  spawn = defaultSpawn,
): string {
  const files = [...agentOutput.filesCreated, ...agentOutput.filesModified];
  if (files.length === 0) return "";
  const res = spawn("git", ["diff", "HEAD", "--", ...files], { cwd: config.workingTree });
  return res.stdout ?? "";
}
