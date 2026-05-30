import { createWorkflow, step } from "@lotiai/composer";
import { describe, expect, test } from "vitest";

import {
  OPEN_PR_STEP_NAME,
  OPEN_PR_STEP_NEEDS,
  OPEN_PR_STEP_PROVIDES,
  type OpenPrStepInput,
  type OpenPrStepOutput,
} from "../openPrStep.js";

// We test the METADATA surface (step name, needs/provides arrays, type shape)
// rather than the side-effecting `openPrStepRun` — the latter shells out to
// git + gh and is exercised by the adapter-level tests in createPr.vitest.ts
// and simpleGitOps.vitest.ts.

describe("openPrStep metadata", () => {
  test("step name is stable", () => {
    expect(OPEN_PR_STEP_NAME).toBe("openPr");
  });

  test("needs lists the toolkit-namespaced worktree path plus PR fields", () => {
    expect([...OPEN_PR_STEP_NEEDS]).toEqual([
      "_toolkit_worktreePath",
      "prBranch",
      "prBaseBranch",
      "prTitle",
      "prBody",
      "commitMessage",
    ]);
  });

  test("provides both _toolkit_prUrl and _toolkit_prNumber", () => {
    expect([...OPEN_PR_STEP_PROVIDES]).toEqual(["_toolkit_prUrl", "_toolkit_prNumber"]);
  });
});

describe("openPrStep wiring into a composer workflow", () => {
  test("a consumer can bind the metadata into step<Bag>() and build a workflow", () => {
    type Bag = OpenPrStepInput & OpenPrStepOutput;

    const openPr = step<Bag>()({
      name: OPEN_PR_STEP_NAME,
      needs: OPEN_PR_STEP_NEEDS,
      provides: OPEN_PR_STEP_PROVIDES,
      run: async () => ({
        _toolkit_prUrl: "https://github.com/o/r/pull/1",
        _toolkit_prNumber: 1,
      }),
    });

    const workflow = createWorkflow<Bag>("test")
      .requires(
        "_toolkit_worktreePath",
        "prBranch",
        "prBaseBranch",
        "prTitle",
        "prBody",
        "commitMessage",
      )
      .build([openPr]);

    expect(workflow).toBeDefined();
    expect(openPr.name).toBe("openPr");
  });
});
