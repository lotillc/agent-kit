import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { restoreFiles } from "@lotiai/agent-kit/git";
import type { SpawnFn } from "@lotiai/agent-kit/ports";
import { defaultSpawn } from "@lotiai/agent-kit/process";
import { addressableFindings, blockingFindings } from "@lotiai/agent-kit/review";

import { readAgentOutput, writeAgentOutput } from "../artifacts/agentOutput.js";
import type { CoverageAgentConfig } from "../config.js";

import type { DroppedFindingEntry } from "./droppedFindings.js";
import { removeTestBlocks } from "./removeTestBlocks.js";
import type { ReviewFinding } from "./reviewer.js";

/**
 * Apply blocking findings to generated files.
 *
 * If every finding for a file maps cleanly to a removable test block, remove
 * only those blocks. Otherwise drop the whole file. When no generated tests
 * remain, revert orphan source edits and rewrite `agent-output.json`.
 */
export interface DowngradeResult {
  /** Count of files touched (partial edit OR full drop). */
  downgraded: number;
  /** Count of filesCreated + filesModified still present after downgrade. */
  remaining: number;
  /** Count of filesCreated still present (feeds the all-dropped branch). */
  remainingCreated: number;
  /** Files fully unlinked from the worktree. */
  droppedFiles: string[];
  /** Files whose source was edited (block-level surgery) but kept on disk. */
  partiallyDowngradedFiles: string[];
  /** Findings per file, for PR body rendering — covers both drop modes. */
  droppedByFile: DroppedFindingEntry[];
  /** Source-edit paths reverted to HEAD (only when every test fully dropped). */
  revertedSourceEdits: string[];
}

export function downgradeTargetsByFindings(
  config: CoverageAgentConfig,
  findings: ReviewFinding[],
  spawn: SpawnFn = defaultSpawn,
): DowngradeResult {
  const agentOutput = readAgentOutput(config.agentOutputPath);

  if (findings.length === 0) {
    return {
      downgraded: 0,
      remaining: agentOutput.filesCreated.length + agentOutput.filesModified.length,
      remainingCreated: agentOutput.filesCreated.length,
      droppedFiles: [],
      partiallyDowngradedFiles: [],
      droppedByFile: [],
      revertedSourceEdits: [],
    };
  }

  const candidates = [...agentOutput.filesCreated, ...agentOutput.filesModified];
  const findingsByFile = new Map<string, ReviewFinding[]>();

  for (const f of findings) {
    const match = candidates.find((p) => p === f.file || p.endsWith(f.file));
    if (!match) continue;
    const bucket = findingsByFile.get(match) ?? [];
    bucket.push(f);
    findingsByFile.set(match, bucket);
  }

  const droppedFiles = new Set<string>();
  const partiallyDowngraded = new Set<string>();

  // First try block-level removal. Fall back to full-file drop.
  for (const [rel, fileFindings] of findingsByFile) {
    // Only generated test files can be edited surgically.
    if (!agentOutput.filesCreated.includes(rel)) {
      droppedFiles.add(rel);
      continue;
    }

    const abs = resolve(config.workingTree, rel);
    if (!existsSync(abs)) {
      droppedFiles.add(rel);
      continue;
    }

    const lines = fileFindings.map((f) => f.line).filter((l): l is number => typeof l === "number");
    if (lines.length !== fileFindings.length) {
      // Missing line info means we cannot localize the edit.
      droppedFiles.add(rel);
      continue;
    }

    let source: string;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      droppedFiles.add(rel);
      continue;
    }

    const result = removeTestBlocks(source, lines);
    if (!result || result.remainingTestCount === 0) {
      droppedFiles.add(rel);
      continue;
    }

    writeFileSync(abs, result.source, "utf8");
    partiallyDowngraded.add(rel);
  }

  // Update agent-output and unlink fully dropped files.
  const filesCreated = agentOutput.filesCreated.filter((p) => !droppedFiles.has(p));
  const filesModifiedAfterDrop = agentOutput.filesModified.filter((p) => !droppedFiles.has(p));

  // If no generated tests remain, revert orphan source edits back to HEAD.
  const revertedSourceEdits: string[] = [];
  let filesModified = filesModifiedAfterDrop;
  if (filesCreated.length === 0 && filesModifiedAfterDrop.length > 0) {
    try {
      restoreFiles({ cwd: config.workingTree, spawn }, filesModifiedAfterDrop);
      revertedSourceEdits.push(...filesModifiedAfterDrop);
      filesModified = [];
    } catch (err) {
      process.stderr.write(
        `[applyFindings] git checkout failed for orphan source edits: ${(err as Error).message}\n` +
          `[applyFindings] continuing with orphan edits in place; drop-marker PR will still open\n`,
      );
    }
  }

  // Prune suspected-bug entries for tests this downgrade removed, so a stale
  // entry can't make the post-downgrade re-validate abort (unmatched declared
  // bug) or render a phantom suspected bug in the PR. Dropped files lose all
  // their entries; partially-downgraded files keep only entries whose marked
  // test still exists in the rewritten source.
  const suspectedBugs = agentOutput.suspectedBugs.filter((b) => {
    if (droppedFiles.has(b.testRepoRel)) return false;
    if (!partiallyDowngraded.has(b.testRepoRel)) return true;
    try {
      return readFileSync(resolve(config.workingTree, b.testRepoRel), "utf8").includes(b.testName);
    } catch {
      return false;
    }
  });

  writeAgentOutput(config.agentOutputPath, {
    ...agentOutput,
    filesCreated,
    filesModified,
    suspectedBugs,
  });

  // Partition cleanup: agent-authored files get unlinked; pre-existing tracked
  // files (from filesModified) get restored to HEAD so a reviewer finding never
  // deletes a checked-in test.
  const toUnlink: string[] = [];
  const toRestore: string[] = [];
  for (const rel of droppedFiles) {
    if (agentOutput.filesCreated.includes(rel)) {
      toUnlink.push(rel);
    } else {
      toRestore.push(rel);
    }
  }
  for (const rel of toUnlink) {
    const abs = resolve(config.workingTree, rel);
    if (existsSync(abs)) {
      rmSync(abs, { force: true });
    }
  }
  if (toRestore.length > 0) {
    try {
      restoreFiles({ cwd: config.workingTree, spawn }, toRestore);
    } catch (err) {
      process.stderr.write(
        `[applyFindings] git checkout failed restoring ${toRestore.length} modified test(s): ${(err as Error).message}\n`,
      );
    }
  }

  const droppedByFile: DroppedFindingEntry[] = Array.from(findingsByFile.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([testRepoRel, findingsForFile]) => ({ testRepoRel, findings: findingsForFile }));

  return {
    downgraded: droppedFiles.size + partiallyDowngraded.size,
    remaining: filesCreated.length + filesModified.length,
    remainingCreated: filesCreated.length,
    droppedFiles: Array.from(droppedFiles).sort(),
    partiallyDowngradedFiles: Array.from(partiallyDowngraded).sort(),
    droppedByFile,
    revertedSourceEdits,
  };
}

export { addressableFindings, blockingFindings };
