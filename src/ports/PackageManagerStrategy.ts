/**
 * Strategy for package-manager-specific commands (install, filtered test, coverage).
 *
 * v1 ships PnpmStrategy only; adding NpmStrategy/YarnStrategy/BunStrategy is a
 * drop-in adapter.
 */
export interface CommandInvocation {
  command: string;
  args: readonly string[];
}

export interface PackageManagerStrategy {
  readonly name: "pnpm" | "npm" | "yarn" | "bun";
  readonly lockfileName: string;
  install(): CommandInvocation;
  runTestInPackage(options: { pkgFilter: string; testFile: string }): CommandInvocation;
  runCoverage(): CommandInvocation;
}
