/**
 * Test-runner conventions (vitest, jest) for a repo.
 *
 * Captures what a Claude agent needs to place a new test file in the right location
 * and match existing style. v1 ships a vitest adapter; jest is a future adapter.
 */
export interface TestRunnerConfig {
  readonly name: "vitest" | "jest";
  readonly testFileSuffix: string;
  readonly testLayout: "mirrored-under-__tests__" | "sibling";
  readonly testFilePatterns: ReadonlyArray<RegExp>;
  readonly exemplarGlobPerPackage: string;
}
