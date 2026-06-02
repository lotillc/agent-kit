import { describe, expect, test } from "vitest";
import type { DiscoveredPackage } from "../selection/discoverPackages.js";
import { selectTarget } from "../selection/selectTarget.js";
import { buildSummary, fileCov, packageDir } from "./fixtures.js";

const packages: DiscoveredPackage[] = [
  { name: "@loti/alpha", dir: packageDir("packages/alpha") },
  { name: "@loti/beta", dir: packageDir("packages/beta") },
];

describe("selectTarget", () => {
  test("returns the top file of the top package", () => {
    const summary = buildSummary({
      "packages/alpha/src/a.ts": fileCov(400, 100),
      "packages/alpha/src/b.ts": fileCov(300, 100),
      "packages/beta/src/c.ts": fileCov(500, 200),
    });
    const result = selectTarget(summary, packages, () => []);
    expect(result?.package.packageName).toBe("@loti/alpha");
    expect(result?.file.relativePath).toBe("src/a.ts");
  });

  test("falls through to next package if top package has no eligible files", () => {
    const summary = buildSummary({
      // Alpha wins package scoring but every file is excluded.
      "packages/alpha/src/things.d.ts": fileCov(800, 0),
      "packages/beta/src/real.ts": fileCov(300, 50),
      "packages/beta/src/other.ts": fileCov(300, 50),
    });
    const result = selectTarget(summary, packages, () => []);
    expect(result?.package.packageName).toBe("@loti/beta");
  });

  test("returns null when no packages qualify", () => {
    const summary = buildSummary({
      "packages/alpha/src/a.ts": fileCov(50, 10),
    });
    expect(selectTarget(summary, packages, () => [])).toBeNull();
  });

  test("attaches exemplars via resolver", () => {
    const summary = buildSummary({
      "packages/alpha/src/a.ts": fileCov(300, 50),
      "packages/alpha/src/b.ts": fileCov(300, 50),
    });
    const result = selectTarget(summary, packages, () => [
      "src/__tests__/a.vitest.ts",
      "src/__tests__/b.vitest.ts",
    ]);
    expect(result?.exemplarTestPaths).toHaveLength(2);
  });

  test("with locBudget > 1, returns multiple targets", () => {
    const summary = buildSummary({
      "packages/alpha/src/a.ts": fileCov(400, 100), // 300 uncov
      "packages/alpha/src/b.ts": fileCov(300, 100), // 200 uncov
      "packages/alpha/src/c.ts": fileCov(300, 100), // 200 uncov
    });
    const result = selectTarget(summary, packages, () => [], { locBudget: 500 });
    expect(result?.targets).toHaveLength(2); // 300 + 200 = 500
  });
});
