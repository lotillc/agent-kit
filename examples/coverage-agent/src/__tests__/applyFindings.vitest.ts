import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SpawnFn } from "@lotiai/agent-kit/ports";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { AgentOutput } from "../artifacts/agentOutput.js";
import type { CoverageAgentConfig } from "../config.js";
import {
  addressableFindings,
  blockingFindings,
  downgradeTargetsByFindings,
} from "../review/applyFindings.js";
import type { ReviewFinding } from "../review/reviewer.js";

function makeConfig(workingTree: string): CoverageAgentConfig {
  return {
    workingTree,
    agentOutputPath: join(workingTree, "agent-output.json"),
  } as unknown as CoverageAgentConfig;
}

function writeAgentOutput(path: string, value: AgentOutput): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeTestFile(workingTree: string, rel: string): string {
  const abs = resolve(workingTree, rel);
  mkdirSync(resolve(abs, ".."), { recursive: true });
  writeFileSync(abs, "// test stub\n", "utf8");
  return abs;
}

function finding(over: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    file: "file.vitest.ts",
    severity: "critical",
    issue: "bad",
    ...over,
  };
}

describe("downgradeTargetsByFindings", () => {
  let workingTree: string;
  let spawn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    workingTree = mkdtempSync(join(tmpdir(), "coverage-agent-drops-"));
    // `restoreFiles` first calls `git ls-tree -r --name-only -z <ref> -- <paths…>`
    // to filter to the subset that exists at `ref`; echo the paths back
    // NUL-delimited so the subsequent `git checkout` actually runs.
    spawn = vi.fn(
      (
        _cmd: string,
        args: readonly string[],
      ): { stdout: string; stderr: string; exitCode: number; signal: null } => {
        if (args[0] === "ls-tree") {
          const dashIdx = args.indexOf("--");
          const paths = dashIdx >= 0 ? args.slice(dashIdx + 1) : [];
          return {
            stdout: paths.length > 0 ? `${paths.join("\0")}\0` : "",
            stderr: "",
            exitCode: 0,
            signal: null,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0, signal: null };
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("no findings -> no-op, returns unchanged counts and empty revert list", () => {
    const config = makeConfig(workingTree);
    writeAgentOutput(config.agentOutputPath, {
      status: "success",
      filesCreated: ["packages/a/src/__tests__/a.vitest.ts"],
      filesModified: ["packages/a/src/a.ts"],
      rationale: "ok",
      suspectedBugs: [],
    });
    writeTestFile(workingTree, "packages/a/src/__tests__/a.vitest.ts");

    const result = downgradeTargetsByFindings(config, [], spawn as unknown as SpawnFn);

    expect(result).toEqual({
      downgraded: 0,
      remaining: 2,
      remainingCreated: 1,
      droppedFiles: [],
      partiallyDowngradedFiles: [],
      droppedByFile: [],
      revertedSourceEdits: [],
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  test("single-target full drop: reverts orphan exports and clears filesModified", () => {
    const config = makeConfig(workingTree);
    const testRel = "packages/a/src/__tests__/a.vitest.ts";
    const srcRel = "packages/a/src/a.ts";
    writeAgentOutput(config.agentOutputPath, {
      status: "success",
      filesCreated: [testRel],
      filesModified: [srcRel],
      rationale: "ok",
      suspectedBugs: [],
    });
    const testAbs = writeTestFile(workingTree, testRel);

    const f = finding({ file: testRel, issue: "codifies bug as correct" });
    const result = downgradeTargetsByFindings(config, [f], spawn as unknown as SpawnFn);

    // Revert happened via git checkout.
    expect(spawn).toHaveBeenCalledWith("git", ["checkout", "HEAD", "--", srcRel], {
      cwd: workingTree,
    });
    expect(result.revertedSourceEdits).toEqual([srcRel]);
    expect(result.downgraded).toBe(1);
    expect(result.remainingCreated).toBe(0);
    expect(result.remaining).toBe(0);
    expect(result.droppedFiles).toEqual([testRel]);
    expect(result.partiallyDowngradedFiles).toEqual([]);
    expect(result.droppedByFile).toEqual([{ testRepoRel: testRel, findings: [f] }]);

    // agent-output.json rewritten with empty filesCreated + filesModified.
    const after = JSON.parse(readFileSync(config.agentOutputPath, "utf8")) as AgentOutput;
    expect(after.filesCreated).toEqual([]);
    expect(after.filesModified).toEqual([]);

    // Test file unlinked from worktree.
    expect(() => readFileSync(testAbs, "utf8")).toThrow();
  });

  test("full drop prunes the dropped file's suspectedBugs entries", () => {
    // Regression fence: a marker-named failing test persisted a suspectedBugs
    // entry in a prior validate pass; dropping the file must remove that entry
    // so the post-downgrade re-validate doesn't abort on an unmatched declared
    // bug (or render a phantom suspected bug in the PR).
    const config = makeConfig(workingTree);
    const testRel = "packages/a/src/__tests__/a.vitest.ts";
    const srcRel = "packages/a/src/a.ts";
    writeAgentOutput(config.agentOutputPath, {
      status: "success",
      filesCreated: [testRel],
      filesModified: [],
      rationale: "ok",
      suspectedBugs: [
        {
          sourceRepoRel: srcRel,
          testRepoRel: testRel,
          testName: "returns wrong sign (suspected bug: drops the negative)",
          rationale: "drops the negative",
        },
      ],
    });
    writeTestFile(workingTree, testRel);

    const f = finding({ file: testRel, issue: "mocks module under test" });
    downgradeTargetsByFindings(config, [f], spawn as unknown as SpawnFn);

    const after = JSON.parse(readFileSync(config.agentOutputPath, "utf8")) as AgentOutput;
    expect(after.suspectedBugs).toEqual([]);
  });

  test("partial downgrade prunes entries for removed tests, keeps survivors", () => {
    const config = makeConfig(workingTree);
    const testRel = "packages/a/src/__tests__/a.vitest.ts";
    const srcRel = "packages/a/src/a.ts";
    const removedName = "extractResourceType: bad (suspected bug: returns null)";
    const keptName = "extractResourceType: iam group (suspected bug: lowercases)";
    writeAgentOutput(config.agentOutputPath, {
      status: "success",
      filesCreated: [testRel],
      filesModified: [srcRel],
      rationale: "ok",
      suspectedBugs: [
        {
          sourceRepoRel: srcRel,
          testRepoRel: testRel,
          testName: removedName,
          rationale: "returns null",
        },
        {
          sourceRepoRel: srcRel,
          testRepoRel: testRel,
          testName: keptName,
          rationale: "lowercases",
        },
      ],
    });
    const abs = resolve(workingTree, testRel);
    mkdirSync(resolve(abs, ".."), { recursive: true });
    const source = [
      `import { describe, test, expect } from "vitest";`,
      ``,
      `import { extractResourceType } from "../a.js";`,
      ``,
      `describe("a", () => {`,
      `  test("${removedName}", () => {`,
      `    expect(extractResourceType("/x")).toBe("x");`,
      `  });`,
      `  test("${keptName}", () => {`,
      `    expect(extractResourceType("/iam/role/foo")).toBe("iam");`,
      `  });`,
      `});`,
      ``,
    ].join("\n");
    writeFileSync(abs, source, "utf8");

    // Finding lands on line 6 — the first (removed) test.
    const f = finding({ file: testRel, line: 6, issue: "pins buggy behavior" });
    const result = downgradeTargetsByFindings(config, [f], spawn as unknown as SpawnFn);

    expect(result.partiallyDowngradedFiles).toEqual([testRel]);
    const after = JSON.parse(readFileSync(config.agentOutputPath, "utf8")) as AgentOutput;
    expect(after.suspectedBugs.map((b) => b.testName)).toEqual([keptName]);
  });

  test("partial drop (multi-test): surviving test kept, source edits untouched", () => {
    const config = makeConfig(workingTree);
    const droppedRel = "packages/a/src/__tests__/a.vitest.ts";
    const keptRel = "packages/a/src/__tests__/b.vitest.ts";
    const srcRel = "packages/a/src/a.ts";
    writeAgentOutput(config.agentOutputPath, {
      status: "success",
      filesCreated: [droppedRel, keptRel],
      filesModified: [srcRel],
      rationale: "ok",
      suspectedBugs: [],
    });
    writeTestFile(workingTree, droppedRel);
    const keptAbs = writeTestFile(workingTree, keptRel);

    const f = finding({ file: droppedRel });
    const result = downgradeTargetsByFindings(config, [f], spawn as unknown as SpawnFn);

    expect(spawn).not.toHaveBeenCalled();
    expect(result.revertedSourceEdits).toEqual([]);
    expect(result.downgraded).toBe(1);
    expect(result.remainingCreated).toBe(1);
    expect(result.remaining).toBe(2);

    const after = JSON.parse(readFileSync(config.agentOutputPath, "utf8")) as AgentOutput;
    expect(after.filesCreated).toEqual([keptRel]);
    expect(after.filesModified).toEqual([srcRel]);

    // Surviving test still present in worktree.
    expect(readFileSync(keptAbs, "utf8")).toBe("// test stub\n");
  });

  test("groups multiple findings for the same dropped file", () => {
    const config = makeConfig(workingTree);
    const testRel = "packages/a/src/__tests__/a.vitest.ts";
    writeAgentOutput(config.agentOutputPath, {
      status: "success",
      filesCreated: [testRel],
      filesModified: [],
      rationale: "ok",
      suspectedBugs: [],
    });
    writeTestFile(workingTree, testRel);

    const f1 = finding({ file: testRel, issue: "first" });
    const f2 = finding({ file: testRel, issue: "second", severity: "high" });
    const result = downgradeTargetsByFindings(config, [f1, f2], spawn as unknown as SpawnFn);

    expect(result.droppedByFile).toEqual([{ testRepoRel: testRel, findings: [f1, f2] }]);
  });

  test("git restore failure on orphan exports: swallows, logs, pipeline proceeds", () => {
    const config = makeConfig(workingTree);
    const testRel = "packages/a/src/__tests__/a.vitest.ts";
    const srcRel = "packages/a/src/a.ts";
    writeAgentOutput(config.agentOutputPath, {
      status: "success",
      filesCreated: [testRel],
      filesModified: [srcRel],
      rationale: "ok",
      suspectedBugs: [],
    });
    writeTestFile(workingTree, testRel);

    // git checkout fails (non-zero exit).
    const failingSpawn = vi.fn(() => ({
      stdout: "",
      stderr: "fatal: not a git repository",
      exitCode: 128,
      signal: null,
    })) as unknown as SpawnFn;
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const f = finding({ file: testRel });
    const result = downgradeTargetsByFindings(config, [f], failingSpawn);

    // revertedSourceEdits empty because checkout failed; filesModified
    // preserved in agent-output so downstream still sees the exports.
    expect(result.revertedSourceEdits).toEqual([]);
    expect(result.droppedFiles).toEqual([testRel]);
    expect(result.downgraded).toBe(1);

    const after = JSON.parse(readFileSync(config.agentOutputPath, "utf8")) as AgentOutput;
    expect(after.filesCreated).toEqual([]);
    expect(after.filesModified).toEqual([srcRel]);

    // Warning surfaced to stderr.
    const messages = errSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(messages).toContain("git checkout failed");
    expect(messages).toContain("drop-marker PR will still open");
  });

  test("blockingFindings: only CRITICAL drops (HIGH is advisory)", () => {
    // Regression fence for PR #2955: three HIGH "missing test for X"
    // findings caused the ENTIRE test file to be dropped, including a
    // correctly-structured bare failing `test(...)` for a real source
    // bug. HIGH findings MUST NOT tear down the file. Only the CRITICAL
    // categories (wrong assertion, mocks the module under test, pins
    // buggy behavior, uses .fails()) remove the test; HIGH surfaces in
    // the PR body for human triage.
    const crit = finding({ severity: "critical", issue: "pins wrong output" });
    const high = finding({ severity: "high", issue: "missing rethrow test" });
    const med = finding({ severity: "medium" });
    const low = finding({ severity: "low" });
    const info = finding({ severity: "info" });
    expect(blockingFindings([crit, high, med, low, info])).toEqual([crit]);
    // A PR with only HIGHs must never drop.
    expect(blockingFindings([high, high, high])).toEqual([]);
  });

  test("addressableFindings: superset of blocking — CRITICAL + HIGH", () => {
    // fix-turn only runs when a CRITICAL exists (gated on blockingFindings),
    // but when it DOES run it gets both CRITICAL and HIGH so the agent can
    // address HIGH while it's already editing. HIGH alone never triggers
    // fix-turn — that's the blockingFindings contract.
    const crit = finding({ severity: "critical" });
    const high = finding({ severity: "high" });
    const med = finding({ severity: "medium" });
    expect(addressableFindings([crit, high, med])).toEqual([crit, high]);
  });

  test("matches findings by suffix (reviewer emits package-relative paths)", () => {
    const config = makeConfig(workingTree);
    const testRel = "packages/a/src/__tests__/a.vitest.ts";
    writeAgentOutput(config.agentOutputPath, {
      status: "success",
      filesCreated: [testRel],
      filesModified: [],
      rationale: "ok",
      suspectedBugs: [],
    });
    writeTestFile(workingTree, testRel);

    const f = finding({ file: "src/__tests__/a.vitest.ts" });
    const result = downgradeTargetsByFindings(config, [f], spawn as unknown as SpawnFn);

    expect(result.downgraded).toBe(1);
    expect(result.droppedFiles).toEqual([testRel]);
  });

  test("surgical removal: bad test spliced out, valid siblings survive on disk", () => {
    // Regression fence for PR #2962: a file with 2 valid bug-pinning tests
    // + 1 tautological test was DROPPED WHOLESALE when re-review caught the
    // tautological one. With block-level granularity, only the bad test is
    // spliced out and the sibling tests ship.
    const config = makeConfig(workingTree);
    const testRel = "packages/a/src/__tests__/a.vitest.ts";
    const srcRel = "packages/a/src/a.ts";
    writeAgentOutput(config.agentOutputPath, {
      status: "success",
      filesCreated: [testRel],
      filesModified: [srcRel],
      rationale: "ok",
      suspectedBugs: [],
    });
    const abs = resolve(workingTree, testRel);
    mkdirSync(resolve(abs, ".."), { recursive: true });
    const source = [
      `import { describe, test, expect } from "vitest";`,
      ``,
      `import { extractResourceType, kmsAlias } from "../a.js";`,
      ``,
      `describe("a", () => {`,
      `  test("extractResourceType: logs group", () => {`,
      `    expect(extractResourceType("/aws/logs/foo")).toBe("logs");`,
      `  });`,
      `  test("kms: tautological", () => {`,
      `    expect(true).toBe(true);`,
      `  });`,
      `  test("extractResourceType: iam group", () => {`,
      `    expect(extractResourceType("/iam/role/foo")).toBe("iam");`,
      `  });`,
      `});`,
      ``,
    ].join("\n");
    writeFileSync(abs, source, "utf8");

    // Finding lands on line 9 — the tautological `test("kms: tautological", ...)`.
    const f = finding({ file: testRel, line: 9, issue: "tautological assertion" });
    const result = downgradeTargetsByFindings(config, [f], spawn as unknown as SpawnFn);

    // File kept, not unlinked, not in droppedFiles.
    expect(result.droppedFiles).toEqual([]);
    expect(result.partiallyDowngradedFiles).toEqual([testRel]);
    expect(result.downgraded).toBe(1);
    expect(result.remainingCreated).toBe(1);
    expect(result.revertedSourceEdits).toEqual([]);
    // Source edits untouched — a surviving test still consumes the export.
    expect(spawn).not.toHaveBeenCalled();

    // droppedByFile still records the finding so the PR body surfaces it.
    expect(result.droppedByFile).toEqual([{ testRepoRel: testRel, findings: [f] }]);

    // Post-condition: file exists, bad test is gone, siblings remain.
    const after = readFileSync(abs, "utf8");
    expect(after).not.toContain("tautological");
    expect(after).toContain("logs group");
    expect(after).toContain("iam group");

    // agent-output.json still lists the file as created.
    const agentAfter = JSON.parse(readFileSync(config.agentOutputPath, "utf8")) as AgentOutput;
    expect(agentAfter.filesCreated).toEqual([testRel]);
    expect(agentAfter.filesModified).toEqual([srcRel]);
  });

  test("surgical removal falls back to full drop when all siblings would be removed", () => {
    // If splicing would leave zero tests, full drop is the right call —
    // we can't ship a test file with no tests.
    const config = makeConfig(workingTree);
    const testRel = "packages/a/src/__tests__/a.vitest.ts";
    writeAgentOutput(config.agentOutputPath, {
      status: "success",
      filesCreated: [testRel],
      filesModified: [],
      rationale: "ok",
      suspectedBugs: [],
    });
    const abs = resolve(workingTree, testRel);
    mkdirSync(resolve(abs, ".."), { recursive: true });
    const source = [
      `import { test, expect } from "vitest";`,
      ``,
      `test("only test", () => {`,
      `  expect(true).toBe(true);`,
      `});`,
      ``,
    ].join("\n");
    writeFileSync(abs, source, "utf8");

    const f = finding({ file: testRel, line: 3, issue: "tautological assertion" });
    const result = downgradeTargetsByFindings(config, [f], spawn as unknown as SpawnFn);

    expect(result.partiallyDowngradedFiles).toEqual([]);
    expect(result.droppedFiles).toEqual([testRel]);
    expect(result.remainingCreated).toBe(0);
    expect(() => readFileSync(abs, "utf8")).toThrow();
  });

  test("surgical removal falls back to full drop when finding has no line info", () => {
    // No localizer -> can't splice safely. Preserves previous all-or-nothing
    // behavior for reviewers that emit file-level findings.
    const config = makeConfig(workingTree);
    const testRel = "packages/a/src/__tests__/a.vitest.ts";
    writeAgentOutput(config.agentOutputPath, {
      status: "success",
      filesCreated: [testRel],
      filesModified: [],
      rationale: "ok",
      suspectedBugs: [],
    });
    writeTestFile(workingTree, testRel);

    const f = finding({ file: testRel, issue: "mocks module under test" });
    const result = downgradeTargetsByFindings(config, [f], spawn as unknown as SpawnFn);

    expect(result.partiallyDowngradedFiles).toEqual([]);
    expect(result.droppedFiles).toEqual([testRel]);
  });

  test("finding on filesModified entry: restore via git checkout, never rmSync", () => {
    // Regression fence: a reviewer finding on a pre-existing tracked test
    // (the agent edited it, so it landed in filesModified) used to fall
    // through the !filesCreated.includes guard and get rmSync'd by the
    // cleanup loop, deleting a tracked file from the worktree. The fix
    // restores it to HEAD instead.
    const config = makeConfig(workingTree);
    const editedTestRel = "packages/a/src/__tests__/existing.vitest.ts";
    writeAgentOutput(config.agentOutputPath, {
      status: "success",
      filesCreated: [],
      filesModified: [editedTestRel],
      rationale: "ok",
      suspectedBugs: [],
    });
    const abs = writeTestFile(workingTree, editedTestRel);

    const f = finding({ file: editedTestRel, issue: "mocks module under test" });
    const result = downgradeTargetsByFindings(config, [f], spawn as unknown as SpawnFn);

    // File goes through the drop path (block-level surgery only applies to
    // filesCreated), but cleanup must restore not rmSync.
    expect(result.droppedFiles).toEqual([editedTestRel]);
    expect(result.partiallyDowngradedFiles).toEqual([]);

    // Restore happened via `git checkout HEAD -- <rel>`.
    const checkoutCalls = spawn.mock.calls.filter(
      (call: readonly unknown[]) => Array.isArray(call[1]) && call[1][0] === "checkout",
    );
    expect(checkoutCalls).toHaveLength(1);
    expect(checkoutCalls[0]?.[1]).toEqual(["checkout", "HEAD", "--", editedTestRel]);

    // Tracked file is still on disk — must NOT have been unlinked.
    expect(() => readFileSync(abs, "utf8")).not.toThrow();
  });
});
