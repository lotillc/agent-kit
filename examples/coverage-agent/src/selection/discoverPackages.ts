import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { z } from "zod";

const PackageJsonSchema = z.object({
  name: z.string().optional(),
});

export type DiscoveredPackage = {
  name: string;
  dir: string;
};

/**
 * Single-package repos synthesize one DiscoveredPackage rooted at repoRoot.
 * Used when config.isSinglePackage is true (no pnpm-workspace.yaml, no
 * `workspaces` field). Reads the root package.json for the name; falls back
 * to the repo directory basename if the package.json is missing or unnamed.
 */
export function synthesizeSinglePackage(repoRoot: string): DiscoveredPackage {
  const pkgJsonPath = resolve(repoRoot, "package.json");
  if (existsSync(pkgJsonPath)) {
    try {
      const parsed = PackageJsonSchema.parse(JSON.parse(readFileSync(pkgJsonPath, "utf8")));
      if (parsed.name) return { name: parsed.name, dir: repoRoot };
    } catch {
      // fall through
    }
  }
  return { name: basename(repoRoot), dir: repoRoot };
}

// Uses an already-computed list of vitest.config.mts files (supplied by the
// caller) so this module stays filesystem-light and unit-testable. The CLI
// wrapper is responsible for the glob.
export function resolvePackagesFromVitestConfigs(
  vitestConfigPaths: string[],
  repoRoot: string,
): DiscoveredPackage[] {
  const normalizedRoot = resolve(repoRoot);
  const packages: DiscoveredPackage[] = [];
  for (const configPath of vitestConfigPaths) {
    const dir = dirname(resolve(repoRoot, configPath));
    // Skip the repo-root aggregator vitest config; it would otherwise claim
    // every file that isn't inside a sub-package.
    if (dir === normalizedRoot) continue;
    const pkgJsonPath = resolve(dir, "package.json");
    let name: string;
    try {
      const parsed = PackageJsonSchema.parse(JSON.parse(readFileSync(pkgJsonPath, "utf8")));
      if (!parsed.name) continue;
      name = parsed.name;
    } catch {
      continue;
    }
    packages.push({ name, dir });
  }
  return packages.sort((a, b) => b.dir.length - a.dir.length);
}

export function findPackageForFile(
  absoluteFilePath: string,
  packages: DiscoveredPackage[],
): DiscoveredPackage | undefined {
  const normalized = absoluteFilePath.endsWith(sep) ? absoluteFilePath : `${absoluteFilePath}`;
  return packages.find((pkg) => {
    const pkgDirWithSep = pkg.dir.endsWith(sep) ? pkg.dir : `${pkg.dir}${sep}`;
    return normalized.startsWith(pkgDirWithSep);
  });
}

export function relativeToPackage(absoluteFilePath: string, pkg: DiscoveredPackage): string {
  return relative(pkg.dir, absoluteFilePath);
}
