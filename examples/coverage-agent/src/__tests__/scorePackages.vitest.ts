import { describe, expect, test } from "vitest";
import type { DiscoveredPackage } from "../selection/discoverPackages.js";
import { aggregateByPackage, scorePackages } from "../selection/scorePackages.js";
import { buildSummary, fileCov, packageDir } from "./fixtures.js";

const packages: DiscoveredPackage[] = [
  { name: "@loti/alpha", dir: packageDir("packages/alpha") },
  { name: "@loti/beta", dir: packageDir("packages/beta") },
  { name: "@loti/small", dir: packageDir("packages/small") },
];

describe("aggregateByPackage", () => {
  test("sums line totals per owning package", () => {
    const summary = buildSummary({
      "packages/alpha/src/a.ts": fileCov(100, 40),
      "packages/alpha/src/b.ts": fileCov(100, 60),
      "packages/beta/src/c.ts": fileCov(200, 100),
      "packages/orphan/src/d.ts": fileCov(50, 10),
    });
    const agg = aggregateByPackage(summary, packages);
    expect(agg.get("@loti/alpha")).toEqual({
      totalLines: 200,
      coveredLines: 100,
      fileCount: 2,
    });
    expect(agg.get("@loti/beta")).toEqual({
      totalLines: 200,
      coveredLines: 100,
      fileCount: 1,
    });
    expect(agg.has("@loti/orphan")).toBe(false);
  });
});

describe("scorePackages", () => {
  test("ranks by uncovered lines descending, excluding tiny packages", () => {
    const summary = buildSummary({
      "packages/alpha/src/a.ts": fileCov(600, 200), // 400 uncovered
      "packages/beta/src/c.ts": fileCov(550, 300), // 250 uncovered
      "packages/small/src/d.ts": fileCov(100, 10), // under 500 LoC filter
    });
    const result = scorePackages(summary, packages);
    expect(result.map((p) => p.packageName)).toEqual(["@loti/alpha", "@loti/beta"]);
    expect(result[0]?.uncoveredLines).toBe(400);
  });

  test("drops packages with 0 uncovered lines", () => {
    const summary = buildSummary({
      "packages/alpha/src/a.ts": fileCov(600, 600),
    });
    expect(scorePackages(summary, packages)).toHaveLength(0);
  });
});
