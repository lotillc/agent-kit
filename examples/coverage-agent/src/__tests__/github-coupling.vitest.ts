import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Portability invariant: all `gh` CLI usage is encapsulated to the
 * known GitHub integration sites. If a new caller appears elsewhere, the
 * blast radius of swapping VCS hosts widens — force the new site to be
 * allowlisted here explicitly, or refactor the call into an existing
 * GitHub module.
 *
 * Allowlisted files are the only places that may spawn the `gh` command.
 * Paths are relative to tools/coverage-agent/src/.
 */
const GH_ALLOWLIST = new Set<string>([
  "pr/openPr.ts",
  "stack/listOpenAgentPrs.ts",
  // doctor runs `gh --version` as a preflight check. Lives in commands/
  // but is dedicated to environment diagnostics; moving it to a vcs/
  // subdirectory would be more churn than benefit.
  "commands/doctor.ts",
]);

const SRC_ROOT = join(__dirname, "..");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === "__tests__" || entry.startsWith(".")) continue;
      walk(full, acc);
    } else if (s.isFile() && full.endsWith(".ts")) {
      acc.push(full);
    }
  }
  return acc;
}

function fileSpawnsGh(source: string): boolean {
  // Catches any first-arg pattern that looks like a command invocation with
  // `gh` as the command. Covers:
  //   spawn("gh", […])
  //   defaultSpawn("gh", […])
  //   checkBin("gh", [...])
  //   `gh pr …` as a template-string command
  // Deliberately broad — false positives from comments are fine because the
  // allowlist is short; false negatives would let a new coupling slip in.
  return /\(\s*["']gh["']\s*,/.test(source) || /spawn[^(]*\(\s*`gh\s/.test(source);
}

describe("GitHub coupling invariant", () => {
  test("gh CLI is only spawned from the allowlisted files", () => {
    const files = walk(SRC_ROOT);
    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(SRC_ROOT, file);
      if (GH_ALLOWLIST.has(rel)) continue;
      const source = readFileSync(file, "utf8");
      if (fileSpawnsGh(source)) {
        violations.push(rel);
      }
    }
    expect(
      violations,
      `new gh call sites — add to GH_ALLOWLIST or move inside GitHub layer`,
    ).toEqual([]);
  });
});
