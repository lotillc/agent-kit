import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { slugify } from "../pr/slugify.js";

import type { DroppedFindingEntry } from "./droppedFindings.js";
import type { ReviewSeverity } from "./reviewer.js";

/**
 * When the reviewer drops every test in a run, the worktree has nothing left
 * to commit (tests unlinked, orphan exports reverted). To keep a durable
 * record — both as the PR's only diff content and as searchable human-
 * readable documentation — we commit a marker file at:
 *
 *   `.coverage-agent-drops/<pkg-slug>--<file-slug>.md`
 *
 * Content: target path, run sha, and the reviewer findings grouped by file
 * and severity. This pairs with the `Quarantine-File:` commit trailer
 * emitted by `open-pr`, which prevents future runs from re-selecting the
 * target (via `walkAncestry` in `commands/select.ts`).
 */
export interface WriteDropMarkerInput {
  workingTree: string;
  packageName: string;
  targetRepoRelativePath: string;
  runSha: string;
  droppedByFile: DroppedFindingEntry[];
}

export interface DropMarkerResult {
  repoRelativePath: string;
  absolutePath: string;
}

const DROPS_DIR = ".coverage-agent-drops";
const SEVERITIES_IN_ORDER: ReviewSeverity[] = ["critical", "high", "medium", "low", "info"];

export function writeDropMarker(input: WriteDropMarkerInput): DropMarkerResult {
  const pkgSlug = slugify(input.packageName);
  const fileSlug = slugify(input.targetRepoRelativePath).slice(0, 80);
  const basename = `${pkgSlug}--${fileSlug}.md`;

  const dirAbs = resolve(input.workingTree, DROPS_DIR);
  const absolutePath = resolve(dirAbs, basename);
  mkdirSync(dirAbs, { recursive: true });

  const content = renderDropMarker(input);
  writeFileSync(absolutePath, content, "utf8");

  return {
    repoRelativePath: `${DROPS_DIR}/${basename}`,
    absolutePath,
  };
}

export function renderDropMarker(input: WriteDropMarkerInput): string {
  const lines: string[] = [];
  lines.push(`# Reviewer-dropped coverage attempt: \`${input.targetRepoRelativePath}\``);
  lines.push("");
  lines.push(`- **Package:** \`${input.packageName}\``);
  lines.push(`- **Run sha:** \`${input.runSha}\``);
  lines.push("");
  lines.push(
    "The coverage agent generated a test for this target, but the reviewer flagged it " +
      "as incorrect (most commonly: the test codified a bug as correct behavior). " +
      "Fix-turn could not repair it, so the test was dropped. This file exists as a " +
      "searchable record; the commit carries a `Quarantine-File:` trailer so future " +
      "runs skip the target.",
  );
  lines.push("");

  for (const entry of input.droppedByFile) {
    lines.push(`## Dropped test: \`${entry.testRepoRel}\``);
    lines.push("");
    for (const sev of SEVERITIES_IN_ORDER) {
      const subset = entry.findings.filter((f) => f.severity === sev);
      if (subset.length === 0) continue;
      lines.push(`### ${sev} (${subset.length})`);
      lines.push("");
      for (const f of subset) {
        const where = f.line ? `${f.file}:${f.line}` : f.file;
        const suggest = f.suggestion ? ` _Suggest: ${f.suggestion}_` : "";
        lines.push(`- \`${where}\` — ${f.issue}${suggest}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
