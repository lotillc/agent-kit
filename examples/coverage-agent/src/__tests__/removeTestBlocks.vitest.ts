import { describe, expect, test } from "vitest";

import { removeTestBlocks } from "../review/removeTestBlocks.js";

describe("removeTestBlocks", () => {
  test("splices a nested `test` inside a describe and preserves siblings", () => {
    const source = [
      `import { describe, test, expect } from "vitest";`, //  1
      ``, //                                                   2
      `describe("a", () => {`, //                              3
      `  test("keeps", () => {`, //                            4
      `    expect(1).toBe(1);`, //                             5
      `  });`, //                                               6
      `  test("drops", () => {`, //                            7
      `    expect(true).toBe(true);`, //                       8
      `  });`, //                                               9
      `  test("also keeps", () => {`, //                       10
      `    expect(2).toBe(2);`, //                             11
      `  });`, //                                               12
      `});`, //                                                 13
      ``, //                                                    14
    ].join("\n");

    const result = removeTestBlocks(source, [8]);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.source).not.toContain(`"drops"`);
    expect(result.source).toContain(`"keeps"`);
    expect(result.source).toContain(`"also keeps"`);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]?.testName).toBe("drops");
    expect(result.remainingTestCount).toBe(2);
  });

  test("splices a top-level `test` call", () => {
    const source = [
      `import { test, expect } from "vitest";`, //             1
      ``, //                                                   2
      `test("alpha", () => { expect(1).toBe(1); });`, //       3
      `test("beta", () => { expect(2).toBe(2); });`, //        4
      ``, //                                                   5
    ].join("\n");

    const result = removeTestBlocks(source, [4]);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.source).toContain(`"alpha"`);
    expect(result.source).not.toContain(`"beta"`);
    expect(result.removed[0]?.testName).toBe("beta");
    expect(result.remainingTestCount).toBe(1);
  });

  test("returns null when a target line doesn't land on any test block", () => {
    const source = [
      `import { test, expect } from "vitest";`, //             1
      ``, //                                                   2
      `test("alpha", () => { expect(1).toBe(1); });`, //       3
    ].join("\n");

    // Line 1 is the import, not a test block.
    expect(removeTestBlocks(source, [1])).toBeNull();
  });

  test("returns null when parse fails", () => {
    const source = `this is not valid typescript };{`;
    expect(removeTestBlocks(source, [1])).toBeNull();
  });

  test("returns null when no target lines are given", () => {
    const source = `test("a", () => { expect(1).toBe(1); });\n`;
    expect(removeTestBlocks(source, [])).toBeNull();
  });

  test("handles `it.each` and other member-expression callees", () => {
    const source = [
      `import { describe, it, expect } from "vitest";`, //     1
      ``, //                                                   2
      `describe("x", () => {`, //                              3
      `  it.each([1, 2])("row %i", (n) => {`, //               4
      `    expect(n).toBeGreaterThan(0);`, //                  5
      `  });`, //                                               6
      `  it("plain", () => {`, //                              7
      `    expect(true).toBe(true);`, //                       8
      `  });`, //                                               9
      `});`, //                                                 10
    ].join("\n");

    const result = removeTestBlocks(source, [5]);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.source).not.toContain(`"row %i"`);
    expect(result.source).toContain(`"plain"`);
    expect(result.remainingTestCount).toBe(1);
  });
});
