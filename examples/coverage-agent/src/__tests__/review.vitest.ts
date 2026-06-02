import type { SpawnFn } from "@lotiai/agent-kit/ports";
import { describe, expect, test, vi } from "vitest";

import type { AgentOutput } from "../artifacts/agentOutput.js";
import { getGeneratedFilesDiff } from "../commands/review.js";
import type { CoverageAgentConfig } from "../config.js";

function config(workingTree: string): CoverageAgentConfig {
  return { workingTree } as unknown as CoverageAgentConfig;
}

function agentOutput(overrides: Partial<AgentOutput> = {}): AgentOutput {
  return {
    status: "success",
    filesCreated: [],
    filesModified: [],
    rationale: "",
    suspectedBugs: [],
    ...overrides,
  };
}

describe("getGeneratedFilesDiff", () => {
  test("scopes `git diff HEAD` to the union of filesCreated and filesModified", () => {
    const spawn = vi.fn(() => ({
      stdout: "diff --git a/x b/x\n",
      stderr: "",
      exitCode: 0,
      signal: null,
    }));
    const out = getGeneratedFilesDiff(
      config("/wt"),
      agentOutput({
        filesCreated: ["packages/a/src/__tests__/a.vitest.ts"],
        filesModified: ["packages/b/src/b.ts"],
      }),
      spawn as unknown as SpawnFn,
    );

    expect(spawn).toHaveBeenCalledWith(
      "git",
      ["diff", "HEAD", "--", "packages/a/src/__tests__/a.vitest.ts", "packages/b/src/b.ts"],
      { cwd: "/wt" },
    );
    expect(out).toBe("diff --git a/x b/x\n");
  });

  test("returns empty string and does not spawn when no files were created or modified", () => {
    const spawn = vi.fn();
    const out = getGeneratedFilesDiff(config("/wt"), agentOutput(), spawn as unknown as SpawnFn);
    expect(out).toBe("");
    expect(spawn).not.toHaveBeenCalled();
  });

  test("tolerates missing stdout (null) by returning an empty string", () => {
    const spawn = vi.fn(() => ({ stdout: null, stderr: "", exitCode: 0, signal: null }));
    const out = getGeneratedFilesDiff(
      config("/wt"),
      agentOutput({ filesCreated: ["x.ts"] }),
      spawn as unknown as SpawnFn,
    );
    expect(out).toBe("");
  });
});
