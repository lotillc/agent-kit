import { describe, expect, test } from "vitest";

import {
  buildStackedBranchName,
  parseSourcePrFromBranch,
  stackedBranchPrefix,
} from "../branchNaming.js";

describe("buildStackedBranchName", () => {
  test("composes prefix + pr-N + shortId", () => {
    expect(
      buildStackedBranchName({ prefix: "agent-review", sourcePrNumber: 42, shortId: "abc" }),
    ).toBe("agent-review/pr-42/abc");
  });
});

describe("stackedBranchPrefix", () => {
  test("returns the prefix for grepping", () => {
    expect(stackedBranchPrefix("my-coverage", 7)).toBe("my-coverage/pr-7/");
  });
});

describe("parseSourcePrFromBranch", () => {
  test.each([
    ["agent-review", "agent-review/pr-42/abc123", 42],
    ["my-coverage", "my-coverage/pr-7/timestamp", 7],
    ["x", "x/pr-999/foo", 999],
  ])("%s + %s → %d", (prefix, branch, expected) => {
    expect(parseSourcePrFromBranch(prefix, branch)).toBe(expected);
  });

  test.each([
    ["agent-review", "feat/something"],
    ["agent-review", "agent-review/pr-/no-number"],
    ["agent-review", "agent-review/pr-notanumber/x"],
    ["agent-review", "other-bot/pr-1/x"],
  ])("%s + %s → null", (prefix, branch) => {
    expect(parseSourcePrFromBranch(prefix, branch)).toBeNull();
  });
});
