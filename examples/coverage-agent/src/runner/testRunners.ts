/**
 * Test runner conventions that are otherwise scattered across the codebase.
 * v1 only ships `VitestConfig`; the interface exists to make the coupling
 * points grep-able so a future adapter knows exactly what to implement.
 *
 * Only the minimal surface needed by current call sites is modeled — the
 * inverse source-path-from-test-path regex in src/stack/walkAncestry.ts and
 * src/commands/openPr.ts quarantine logic is intentionally NOT on this
 * interface yet (Option A from the portability plan). Those two sites keep
 * hand-written regexes; comments point back here.
 */
export interface TestRunnerConfig {
  readonly name: "vitest" | "jest";
  /** Suffix appended to source basenames to form test filenames (e.g. ".vitest.ts"). */
  readonly testFileSuffix: string;
  /**
   * Layout convention:
   *   "mirrored-under-__tests__" — src/foo/bar.ts → src/__tests__/foo/bar<suffix>
   *   "sibling"                  — src/foo/bar.ts → src/foo/bar<suffix>
   * Used by invokeClaude when choosing where to write the generated test.
   */
  readonly testLayout: "mirrored-under-__tests__" | "sibling";
  /**
   * Regex patterns identifying paths Claude is allowed to create/edit.
   * Checked by validateDiff against each changed file. At least one pattern
   * must match or the diff gate rejects the file as disallowed source edits.
   */
  readonly testFilePatterns: readonly RegExp[];
  /**
   * Regex matching non-test source files the agent may *read* during test
   * generation. Currently only used by the exemplar-loader glob. The
   * default is an empty list, which means "no restriction" — the loader
   * applies its own logic.
   */
  readonly exemplarGlobPerPackage: string;
}

export const VitestConfig: TestRunnerConfig = {
  name: "vitest",
  testFileSuffix: ".vitest.ts",
  testLayout: "mirrored-under-__tests__",
  testFilePatterns: [
    // Test + fixture files: any suffix .vitest.ts / .fixture(s).ts OR
    // anywhere under a __tests__/ directory.
    /^(packages|services|josu|infrastructure|tools|experimental)\/.+\.(vitest\.ts|fixtures?\.ts)$|(^|\/)__tests__\//,
  ],
  exemplarGlobPerPackage: "src/**/*.vitest.ts",
};

/**
 * Resolve the active test runner config. v1 throws on any non-vitest value
 * with a clear pointer — same pattern as resolvePackageManagerStrategy.
 */
export function resolveTestRunnerConfig(name: string | undefined): TestRunnerConfig {
  const effective = name ?? "vitest";
  switch (effective) {
    case "vitest":
      return VitestConfig;
    default:
      throw new Error(
        `COVERAGE_AGENT_TEST_RUNNER=${effective} is not implemented in v1. Only "vitest" is supported. Add a config in src/runner/testRunners.ts.`,
      );
  }
}

/**
 * Map a package-relative source path to its conventional test path per the
 * runner's layout. Kept here so the forward-mapping logic is colocated with
 * the runner definition.
 *
 *   vitest mirrored layout:
 *     src/foo.ts          → src/__tests__/foo.vitest.ts
 *     src/nested/bar.ts   → src/__tests__/nested/bar.vitest.ts
 *
 *   sibling layout:
 *     src/foo.ts          → src/foo.vitest.ts
 *     src/nested/bar.ts   → src/nested/bar.vitest.ts
 *
 * The inverse mapping (test path → source) is hand-written in
 * src/stack/walkAncestry.ts and src/commands/openPr.ts — if you change the
 * layout rule here, update those regexes too.
 */
export function testFileRelativePath(
  sourceRelativeToPackage: string,
  config: TestRunnerConfig,
): string {
  const withoutExt = sourceRelativeToPackage.replace(/\.ts$/, "");
  if (config.testLayout === "sibling") {
    return `${withoutExt}${config.testFileSuffix}`;
  }
  const withoutSrc = withoutExt.replace(/^src\//, "");
  return `src/__tests__/${withoutSrc}${config.testFileSuffix}`;
}
