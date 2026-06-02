import { describe, expect, test } from "vitest";
import type { DiscoveredPackage } from "../selection/discoverPackages.js";
import { pickFilesWithinBudget, scoreFilesInPackage } from "../selection/scoreFiles.js";
import type { FileScore } from "../types.js";
import { buildSummary, fileCov, packageDir, REPO_ROOT } from "./fixtures.js";

const alpha: DiscoveredPackage = {
  name: "@loti/alpha",
  dir: packageDir("packages/alpha"),
};
const packages = [alpha];

describe("scoreFilesInPackage", () => {
  test("ranks by uncovered lines and excludes declaration/generated/config", () => {
    const summary = buildSummary({
      "packages/alpha/src/real.ts": fileCov(300, 100),
      "packages/alpha/src/other.ts": fileCov(200, 50),
      "packages/alpha/src/types.d.ts": fileCov(50, 0),
      "packages/alpha/src/thing.types.ts": fileCov(50, 0),
      "packages/alpha/src/generated/foo.ts": fileCov(100, 0),
      "packages/alpha/src/setup.ts": fileCov(40, 0),
      "packages/alpha/src/app.config.ts": fileCov(40, 0),
      "packages/alpha/src/migrations/001.ts": fileCov(30, 0),
    });
    const result = scoreFilesInPackage(summary, alpha, packages);
    expect(result.map((f) => f.relativePath)).toEqual(["src/real.ts", "src/other.ts"]);
    expect(result[0]?.uncoveredLines).toBe(200);
  });

  test("excludes barrel index files under 20 LoC", () => {
    const summary = buildSummary({
      "packages/alpha/src/index.ts": fileCov(10, 0),
      "packages/alpha/src/real.ts": fileCov(100, 20),
    });
    const result = scoreFilesInPackage(summary, alpha, packages);
    expect(result.map((f) => f.relativePath)).toEqual(["src/real.ts"]);
  });

  test("keeps substantial index.ts files", () => {
    const summary = buildSummary({
      "packages/alpha/src/index.ts": fileCov(80, 10),
    });
    const result = scoreFilesInPackage(summary, alpha, packages);
    expect(result.map((f) => f.relativePath)).toEqual(["src/index.ts"]);
  });

  test("excludes files over 500 LoC", () => {
    const summary = buildSummary({
      "packages/alpha/src/big.ts": fileCov(700, 0),
      "packages/alpha/src/ok.ts": fileCov(200, 10),
    });
    const result = scoreFilesInPackage(summary, alpha, packages);
    expect(result.map((f) => f.relativePath)).toEqual(["src/ok.ts"]);
  });

  test("excludes files present in coveredSet (stack ancestry)", () => {
    const summary = buildSummary({
      "packages/alpha/src/a.ts": fileCov(200, 50),
      "packages/alpha/src/b.ts": fileCov(200, 50),
    });
    const coveredSet = new Set(["packages/alpha/src/a.ts"]);
    const result = scoreFilesInPackage(summary, alpha, packages, {
      repoRoot: REPO_ROOT,
      coveredSet,
    });
    expect(result.map((f) => f.relativePath)).toEqual(["src/b.ts"]);
  });

  test("excludes files in quarantine map (from commit trailers)", () => {
    const summary = buildSummary({
      "packages/alpha/src/a.ts": fileCov(200, 50),
      "packages/alpha/src/b.ts": fileCov(200, 50),
    });
    const quarantinedMap = new Map([["packages/alpha/src/a.ts", "side-effect main"]]);
    const result = scoreFilesInPackage(summary, alpha, packages, {
      repoRoot: REPO_ROOT,
      quarantinedMap,
    });
    expect(result.map((f) => f.relativePath)).toEqual(["src/b.ts"]);
  });

  test("skips files that belong to a different package", () => {
    const summary = buildSummary({
      "packages/alpha/src/a.ts": fileCov(200, 50),
      "packages/beta/src/b.ts": fileCov(200, 50),
    });
    const result = scoreFilesInPackage(summary, alpha, [
      alpha,
      { name: "@loti/beta", dir: packageDir("packages/beta") },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.relativePath).toBe("src/a.ts");
  });
});

function score(uncovered: number, name: string = `f${uncovered}`): FileScore {
  return {
    absolutePath: `/r/${name}`,
    relativePath: name,
    uncoveredLines: uncovered,
    totalLines: uncovered + 10,
    linePct: 0,
    branchPct: 0,
  };
}

describe("pickFilesWithinBudget", () => {
  test("returns empty for empty input", () => {
    expect(pickFilesWithinBudget([], { budgetUncoveredLines: 100 })).toEqual([]);
  });

  test("picks top-1 when budget = 1", () => {
    expect(
      pickFilesWithinBudget([score(500), score(300)], { budgetUncoveredLines: 1 }),
    ).toHaveLength(1);
  });

  test("picks prefix that fits in budget", () => {
    const picked = pickFilesWithinBudget([score(300), score(200), score(200), score(100)], {
      budgetUncoveredLines: 500,
    });
    expect(picked).toHaveLength(2); // 300 + 200 = 500
  });

  test("always includes at least one file, even if that alone exceeds budget", () => {
    expect(pickFilesWithinBudget([score(1200)], { budgetUncoveredLines: 800 })).toHaveLength(1);
  });

  test("stops before overshoot once at least one file is taken", () => {
    const picked = pickFilesWithinBudget([score(100), score(100), score(100), score(100)], {
      budgetUncoveredLines: 250,
    });
    // Take [100, 100] = 200. Third would overshoot to 300 > 250 → stop.
    expect(picked).toHaveLength(2);
  });

  test("maxFiles cap stops before LoC budget is reached", () => {
    const picked = pickFilesWithinBudget(
      [score(100), score(100), score(100), score(100), score(100)],
      { budgetUncoveredLines: 10_000, maxFiles: 3 },
    );
    // LoC budget is vast (10k) but maxFiles=3 forces a 3-file cap.
    expect(picked).toHaveLength(3);
  });

  test("LoC cap still stops first when maxFiles is slack", () => {
    const picked = pickFilesWithinBudget([score(100), score(100), score(100), score(100)], {
      budgetUncoveredLines: 250,
      maxFiles: 10,
    });
    // 100 + 100 = 200; next would overshoot to 300 > 250 → stop at 2 even
    // though the 10-file cap leaves room.
    expect(picked).toHaveLength(2);
  });

  test("maxFiles = 0 returns empty even with budget", () => {
    expect(pickFilesWithinBudget([score(100)], { budgetUncoveredLines: 500, maxFiles: 0 })).toEqual(
      [],
    );
  });

  test("maxFiles = 1 returns exactly one file (trumps LoC budget)", () => {
    const picked = pickFilesWithinBudget([score(100), score(100), score(100)], {
      budgetUncoveredLines: 10_000,
      maxFiles: 1,
    });
    expect(picked).toHaveLength(1);
  });
});
