import { describe, expect, test } from "vitest";

import type { OpenPr } from "../listOpenPrs.js";
import { resolveStackBase } from "../resolveStackBase.js";

const pr = (number: number, headRefName: string, baseRefName: string): OpenPr => ({
  number,
  headRefName,
  headRefOid: "sha",
  baseRefName,
});

describe("resolveStackBase", () => {
  test("falls back to sandbox branch when no open PRs", () => {
    const result = resolveStackBase({ sandboxBranch: "sandbox", openPrs: [] });
    expect(result).toEqual({
      baseBranch: "sandbox",
      baseRef: "origin/sandbox",
      isStacked: false,
      openPrs: [],
    });
  });

  test("stacks onto newest PR in the chain rooted at sandboxBranch", () => {
    // Three PRs stacked on top of "main": #5 → main, #7 → feat/a, #9 → feat/b.
    const prs = [pr(5, "feat/a", "main"), pr(7, "feat/b", "feat/a"), pr(9, "feat/c", "feat/b")];
    const result = resolveStackBase({ sandboxBranch: "main", openPrs: prs });
    expect(result.baseBranch).toBe("feat/c");
    expect(result.baseRef).toBe("origin/feat/c");
    expect(result.isStacked).toBe(true);
  });

  test("falls back when no open PR's chain reaches sandboxBranch", () => {
    // PRs exist but they're all based on "main", and the current run targets
    // "sandbox" — so we must not stack onto them.
    const prs = [pr(5, "feat/a", "main"), pr(9, "feat/b", "main")];
    const result = resolveStackBase({ sandboxBranch: "sandbox", openPrs: prs });
    expect(result.baseBranch).toBe("sandbox");
    expect(result.isStacked).toBe(false);
  });

  test("picks the correct chain when two disjoint stacks exist", () => {
    // Stack A on "sandbox-a": #3 → sandbox-a, #5 → feat/a1.
    // Stack B on "sandbox-b": #9 → sandbox-b.
    // Run targets sandbox-a; we must NOT pick #9 just because it has the
    // highest number — it belongs to a different chain.
    const prs = [
      pr(3, "feat/a1", "sandbox-a"),
      pr(5, "feat/a2", "feat/a1"),
      pr(9, "feat/b1", "sandbox-b"),
    ];
    const result = resolveStackBase({ sandboxBranch: "sandbox-a", openPrs: prs });
    expect(result.baseBranch).toBe("feat/a2");
    expect(result.isStacked).toBe(true);
  });

  test("honors remote override", () => {
    const result = resolveStackBase({
      sandboxBranch: "main",
      openPrs: [],
      remote: "upstream",
    });
    expect(result.baseRef).toBe("upstream/main");
  });

  test("tolerates a cycle in baseRefName references", () => {
    // Pathological: #5 says base=feat/b, #7 says base=feat/a. Cycle.
    // Must not infinite-loop; falls back to sandboxBranch.
    const prs = [pr(5, "feat/a", "feat/b"), pr(7, "feat/b", "feat/a")];
    const result = resolveStackBase({ sandboxBranch: "main", openPrs: prs });
    expect(result.baseBranch).toBe("main");
    expect(result.isStacked).toBe(false);
  });
});
