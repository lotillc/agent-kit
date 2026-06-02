import { describe, expect, test } from "vitest";

import { STACK_BRANCH_PREFIX, validateAllowedBaseBranch } from "../pr/baseBranchGate.js";

const DEFAULT_ALLOWED = ["main", "coverage-agent/sandbox"] as const;

describe("validateAllowedBaseBranch", () => {
  test("allows main when included in allowedBaseBranches (direct-to-main rollout)", () => {
    expect(
      validateAllowedBaseBranch({
        baseBranch: "main",
        allowedBaseBranches: DEFAULT_ALLOWED,
      }),
    ).toBeNull();
  });

  test("refuses an unlisted base branch", () => {
    const err = validateAllowedBaseBranch({
      baseBranch: "master",
      allowedBaseBranches: DEFAULT_ALLOWED,
    });
    expect(err).not.toBeNull();
    expect(err).toContain("refusing to open PR against master");
  });

  test("refuses when allowedBaseBranches omits main (lock-down scenario)", () => {
    expect(
      validateAllowedBaseBranch({
        baseBranch: "main",
        allowedBaseBranches: ["coverage-agent/sandbox"],
      }),
    ).not.toBeNull();
  });

  test("allows a stacked base (coverage-agent/run/* prefix) even if not listed", () => {
    expect(
      validateAllowedBaseBranch({
        baseBranch: `${STACK_BRANCH_PREFIX}alpha/bar-def5678`,
        allowedBaseBranches: ["main"],
      }),
    ).toBeNull();
  });

  test("allows a sandbox base when listed", () => {
    expect(
      validateAllowedBaseBranch({
        baseBranch: "coverage-agent/sandbox",
        allowedBaseBranches: DEFAULT_ALLOWED,
      }),
    ).toBeNull();
  });
});
