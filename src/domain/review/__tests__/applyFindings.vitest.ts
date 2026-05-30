import { describe, expect, test } from "vitest";

import {
  addressableFindings,
  blockingFindings,
  downgradeTargetsByFindings,
} from "../applyFindings.js";
import type { ReviewFinding } from "../consensus.js";

const finding = (filePath: string, severity: ReviewFinding["severity"]): ReviewFinding => ({
  id: filePath,
  filePath,
  severity,
  description: "d",
  flaggedBy: ["a"],
  consensus: "single",
  autoFixable: false,
});

describe("blockingFindings", () => {
  test("includes only critical, excludes high/medium/low/info", () => {
    const filtered = blockingFindings([
      finding("a", "critical"),
      finding("b", "high"),
      finding("c", "medium"),
      finding("d", "low"),
      finding("e", "info"),
    ]);
    expect(filtered.map((f) => f.filePath).sort()).toEqual(["a"]);
  });
});

describe("addressableFindings", () => {
  test("includes critical and high, excludes medium/low/info", () => {
    const filtered = addressableFindings([
      finding("a", "critical"),
      finding("b", "high"),
      finding("c", "medium"),
      finding("d", "low"),
      finding("e", "info"),
    ]);
    expect(filtered.map((f) => f.filePath).sort()).toEqual(["a", "b"]);
  });
});

describe("downgradeTargetsByFindings", () => {
  test("drops files matched by blocking findings", () => {
    const result = downgradeTargetsByFindings({
      filesCreated: ["packages/a/src/x.vitest.ts"],
      filesModified: ["packages/a/src/__tests__/y.vitest.ts"],
      findings: [finding("x.vitest.ts", "critical"), finding("y.vitest.ts", "medium")],
    });
    expect(result.downgraded).toBe(1);
    expect(result.remaining).toBe(1);
    expect(result.droppedFiles).toEqual(["packages/a/src/x.vitest.ts"]);
  });

  test("ignores high-only findings for drop planning", () => {
    const result = downgradeTargetsByFindings({
      filesCreated: ["packages/a/src/x.vitest.ts"],
      filesModified: ["packages/a/src/__tests__/y.vitest.ts"],
      findings: [finding("x.vitest.ts", "high"), finding("y.vitest.ts", "high")],
    });
    expect(result.downgraded).toBe(0);
    expect(result.remaining).toBe(2);
    expect(result.droppedFiles).toEqual([]);
  });

  test("ignores non-blocking findings", () => {
    const result = downgradeTargetsByFindings({
      filesCreated: ["x.vitest.ts"],
      filesModified: [],
      findings: [finding("x.vitest.ts", "medium")],
    });
    expect(result.downgraded).toBe(0);
    expect(result.remainingCreated).toEqual(["x.vitest.ts"]);
  });

  test("matches suffix on either side (agent path ≠ finding path but one is a suffix of the other)", () => {
    const result = downgradeTargetsByFindings({
      filesCreated: ["packages/a/src/__tests__/foo.vitest.ts"],
      filesModified: [],
      findings: [finding("src/__tests__/foo.vitest.ts", "critical")],
    });
    expect(result.downgraded).toBe(1);
  });

  test("empty input → zero downgrades", () => {
    const result = downgradeTargetsByFindings({
      filesCreated: [],
      filesModified: [],
      findings: [],
    });
    expect(result).toEqual({
      droppedFiles: [],
      remainingCreated: [],
      remainingModified: [],
      downgraded: 0,
      remaining: 0,
    });
  });
});
