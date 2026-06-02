import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { renderDropMarker, writeDropMarker } from "../review/writeDropMarker.js";

const sampleDroppedByFile = [
  {
    testRepoRel: "packages/cli/src/__tests__/audit-aws-resources.vitest.ts",
    findings: [
      {
        file: "packages/cli/src/__tests__/audit-aws-resources.vitest.ts",
        line: 42,
        severity: "critical" as const,
        issue: "Test codifies a bug as correct behavior",
        suggestion: "Flip to test.fails() with corrected assertion",
      },
      {
        file: "packages/cli/src/__tests__/audit-aws-resources.vitest.ts",
        severity: "high" as const,
        issue: "Mocks the module under test",
      },
    ],
  },
];

describe("renderDropMarker", () => {
  test("emits target info + findings grouped by severity", () => {
    const content = renderDropMarker({
      workingTree: "/wt",
      packageName: "@loti/cli",
      targetRepoRelativePath: "packages/cli/src/audit-aws-resources.ts",
      runSha: "abc1234",
      droppedByFile: sampleDroppedByFile,
    });

    expect(content).toContain("# Reviewer-dropped coverage attempt");
    expect(content).toContain("packages/cli/src/audit-aws-resources.ts");
    expect(content).toContain("**Package:** `@loti/cli`");
    expect(content).toContain("**Run sha:** `abc1234`");
    expect(content).toContain(
      "## Dropped test: `packages/cli/src/__tests__/audit-aws-resources.vitest.ts`",
    );
    expect(content).toContain("### critical (1)");
    expect(content).toContain("### high (1)");
    // file:line rendering when line is present
    expect(content).toContain("`packages/cli/src/__tests__/audit-aws-resources.vitest.ts:42`");
    // suggestion rendered inline
    expect(content).toContain("_Suggest: Flip to test.fails() with corrected assertion_");
    // explanation referencing the quarantine trailer
    expect(content).toContain("Quarantine-File:");
  });

  test("skips empty severity buckets", () => {
    const content = renderDropMarker({
      workingTree: "/wt",
      packageName: "@loti/cli",
      targetRepoRelativePath: "packages/cli/src/foo.ts",
      runSha: "deadbee",
      droppedByFile: [
        {
          testRepoRel: "packages/cli/src/__tests__/foo.vitest.ts",
          findings: [
            {
              file: "packages/cli/src/__tests__/foo.vitest.ts",
              severity: "critical",
              issue: "bad",
            },
          ],
        },
      ],
    });

    expect(content).toContain("### critical (1)");
    expect(content).not.toContain("### medium");
    expect(content).not.toContain("### low");
    expect(content).not.toContain("### info");
  });
});

describe("writeDropMarker", () => {
  test("writes the file under .coverage-agent-drops with slugified basename", () => {
    const workingTree = mkdtempSync(join(tmpdir(), "coverage-agent-marker-"));
    const result = writeDropMarker({
      workingTree,
      packageName: "@loti/cli",
      targetRepoRelativePath: "packages/cli/src/audit-aws-resources.ts",
      runSha: "abc1234",
      droppedByFile: sampleDroppedByFile,
    });

    // repoRelativePath lives under the well-known directory.
    expect(result.repoRelativePath.startsWith(".coverage-agent-drops/")).toBe(true);
    expect(result.repoRelativePath.endsWith(".md")).toBe(true);
    // Basename encodes both package and file slugs (separator: `--`).
    expect(result.repoRelativePath).toContain("--");

    // File contents match the renderer.
    const onDisk = readFileSync(result.absolutePath, "utf8");
    expect(onDisk).toContain("# Reviewer-dropped coverage attempt");
    expect(onDisk).toContain("`packages/cli/src/audit-aws-resources.ts`");
  });
});
