import { writeFileSync } from "node:fs";

export interface StrykerConfigInput {
  /**
   * One or more files under mutation, relative to the package directory.
   * `mutateRelativePath` is the single-file convenience; `mutateRelativePaths`
   * takes precedence when both are supplied and is how batched runs pass
   * a union of targets. At least one must be provided.
   */
  mutateRelativePath?: string;
  mutateRelativePaths?: readonly string[];
  /** Where to write the mutation JSON report, relative to the package directory. */
  reportJsonRelativePath?: string;
  /** Per-test mutation timeout in ms. */
  timeoutMs?: number;
}

export function buildStrykerConfig(input: StrykerConfigInput): Record<string, unknown> {
  const mutate =
    input.mutateRelativePaths && input.mutateRelativePaths.length > 0
      ? [...input.mutateRelativePaths]
      : input.mutateRelativePath
        ? [input.mutateRelativePath]
        : undefined;
  if (!mutate) {
    throw new Error(
      "buildStrykerConfig: must supply either mutateRelativePath or a non-empty mutateRelativePaths",
    );
  }
  return {
    testRunner: "vitest",
    vitest: { configFile: "vitest.config.mts" },
    mutate,
    reporters: ["json"],
    jsonReporter: {
      fileName: input.reportJsonRelativePath ?? "reports/mutation/mutation.json",
    },
    coverageAnalysis: "perTest",
    timeoutMS: input.timeoutMs ?? 60_000,
  };
}

export function writeStrykerConfig(path: string, input: StrykerConfigInput): void {
  writeFileSync(path, `${JSON.stringify(buildStrykerConfig(input), null, 2)}\n`, "utf8");
}
