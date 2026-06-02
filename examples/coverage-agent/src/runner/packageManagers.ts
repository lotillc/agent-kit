/**
 * Package-manager-specific commands the agent needs to spawn. v1 only ships
 * `PnpmStrategy` — other managers exist in the interface purely so the
 * coupling points are explicit and downstream repos don't have to grep the
 * codebase when they want to add one.
 *
 * Do NOT parameterize the prompt template as a single `{filter} {path}`
 * string. The command shapes differ too much (pnpm uses `--filter`, yarn
 * uses `workspace`, npm uses `--workspace`, bun uses `--filter`), and the
 * install commands diverge further (`pnpm install --frozen-lockfile` vs
 * `npm ci` vs `yarn install --frozen-lockfile` vs `bun install --frozen-lockfile`).
 * A strategy object captures the shape correctly; a template string hides
 * the edge cases.
 */
export interface PackageManagerStrategy {
  readonly name: "pnpm" | "npm" | "yarn" | "bun";
  /** Lockfile committed to the repo — used by preflight to verify install state. */
  readonly lockfileName: string;
  /** Command to install deps in a worktree, frozen to the lockfile. */
  install(): { command: string; args: readonly string[] };
  /** Command to run a single vitest test file, filtered to the package. */
  runTestInPackage(opts: { pkgFilter: string; testFile: string }): {
    command: string;
    args: readonly string[];
  };
  /** Command to run the repo-wide coverage baseline. */
  runCoverage(): { command: string; args: readonly string[] };
}

export const PnpmStrategy: PackageManagerStrategy = {
  name: "pnpm",
  lockfileName: "pnpm-lock.yaml",
  install: () => ({
    command: "pnpm",
    args: ["install", "--frozen-lockfile", "--prefer-offline"],
  }),
  runTestInPackage: ({ pkgFilter, testFile }) => ({
    command: "pnpm",
    args: ["--filter", pkgFilter, "exec", "vitest", "run", testFile],
  }),
  runCoverage: () => ({ command: "pnpm", args: ["test:coverage"] }),
};

/**
 * Render a strategy output into a copy/pasteable shell command string. Used
 * for rendering the canonical test command into the prompt.
 */
export function renderCommand(cmd: { command: string; args: readonly string[] }): string {
  return [cmd.command, ...cmd.args].join(" ");
}

/**
 * Resolve the configured strategy. v1 rejects anything other than pnpm with
 * a clear error — the interface exists to make the coupling points obvious,
 * not to silently succeed when someone hasn't implemented a new strategy.
 */
export function resolvePackageManagerStrategy(name: string | undefined): PackageManagerStrategy {
  const effective = name ?? "pnpm";
  switch (effective) {
    case "pnpm":
      return PnpmStrategy;
    default:
      throw new Error(
        `COVERAGE_AGENT_PACKAGE_MANAGER=${effective} is not implemented in v1. Only "pnpm" is supported. Add a strategy in src/runner/packageManagers.ts.`,
      );
  }
}
