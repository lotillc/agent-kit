import type { SpawnFn } from "@lotiai/agent-kit/ports";
import { defaultSpawn } from "@lotiai/agent-kit/process";

export interface StackAncestry {
  /** Repo-relative source file paths inferred from added `*.vitest.ts` files. */
  coveredSourceFiles: Set<string>;
  /** Map: source repo-relative path → reason (from Quarantine-File trailers). */
  quarantinedFiles: Map<string, string>;
}

export interface WalkAncestryOptions {
  baseRef: string;
  upstreamRef: string;
  cwd: string;
  spawn?: SpawnFn;
}

export function walkAncestry(options: WalkAncestryOptions): StackAncestry {
  const spawn = options.spawn ?? defaultSpawn;

  const addedRes = spawn(
    "git",
    [
      "log",
      `${options.upstreamRef}..${options.baseRef}`,
      "--name-only",
      "--diff-filter=A",
      "--pretty=format:",
    ],
    { cwd: options.cwd },
  );

  const covered = new Set<string>();
  for (const file of addedRes.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (!file.endsWith(".vitest.ts")) continue;
    const source = inferSourceFromVitest(file);
    if (source) covered.add(source);
  }

  const logRes = spawn(
    "git",
    ["log", `${options.upstreamRef}..${options.baseRef}`, "--pretty=format:%B%x1e"],
    { cwd: options.cwd },
  );

  const quarantined = new Map<string, string>();
  for (const commitBody of logRes.stdout.split("\x1e")) {
    for (const match of commitBody.matchAll(/^Quarantine-File:\s*(\S+)\s*\(([^)]+)\)\s*$/gm)) {
      const path = match[1];
      const reason = match[2];
      if (path && reason) quarantined.set(path, reason);
    }
  }

  return { coveredSourceFiles: covered, quarantinedFiles: quarantined };
}

/**
 * packages/alpha/src/__tests__/foo.vitest.ts → packages/alpha/src/foo.ts
 * packages/alpha/src/__tests__/sub/foo.vitest.ts → packages/alpha/src/sub/foo.ts
 */
export function inferSourceFromVitest(vitestPath: string): string | null {
  const m = vitestPath.match(/^(.*?)\/src\/__tests__\/(.+?)\.vitest\.ts$/);
  if (!m) return null;
  return `${m[1]}/src/${m[2]}.ts`;
}
