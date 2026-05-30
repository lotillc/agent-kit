import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

/**
 * Build a PATH value guaranteed to contain the dirs an agent CLI's Bash tool
 * needs to resolve `node`, `pnpm`, `tsx`, and `vitest`.
 *
 * The Bash tool runs in a sanitized subshell — even though we pass PATH through
 * via the CLI spawn, PATH entries added by shell init files (Volta's
 * `~/.volta/bin`) or by `$GITHUB_PATH` (CI's setup-pnpm bin dir) have been
 * observed to drop, breaking `pnpm --filter X exec vitest` with
 * "command not found".
 *
 * We prepend — in order of most specific to most general:
 *   1. `dirname(process.execPath)` — covers node in both local Volta and CI
 *      setup-node installs. Always present.
 *   2. The dir of `pnpm` as resolved via the current PATH (walking entries
 *      for an executable named `pnpm`). Covers CI setup-pnpm where pnpm
 *      lives in its own `~/setup-pnpm/node_modules/.bin` dir, separate from
 *      node.
 *   3. `$VOLTA_HOME/bin` if the env var is set and the dir exists locally.
 *
 * POSIX-only (macOS/Linux); no Windows `.exe`/`.cmd` probing.
 */
export const ensureNodeOnPath = (current: string | undefined): string => {
  const preferred: string[] = [];
  const addPreferred = (dir: string | undefined): void => {
    if (dir && !preferred.includes(dir)) preferred.push(dir);
  };

  addPreferred(dirname(process.execPath));
  addPreferred(findBinDir("pnpm", current));

  const voltaHome = process.env.VOLTA_HOME;
  if (voltaHome) {
    const voltaBin = join(voltaHome, "bin");
    if (existsSync(voltaBin)) addPreferred(voltaBin);
  }

  if (preferred.length === 0) return current ?? "";
  // Front-load the preferred dirs and drop duplicates + empty segments from the
  // rest of PATH, so a de-prioritized copy can't shadow the version we want and
  // an empty entry can't turn into an implicit CWD lookup.
  const rest = current
    ? current.split(delimiter).filter((entry) => entry !== "" && !preferred.includes(entry))
    : [];
  return [...preferred, ...rest].join(delimiter);
};

/**
 * Walk the entries of `current` (or `process.env.PATH`) and return the first
 * directory containing an executable named `bin`. Mirrors `which(1)` without
 * shelling out. Returns `undefined` if not found.
 */
export const findBinDir = (bin: string, current: string | undefined): string | undefined => {
  const searchPath = current ?? process.env.PATH ?? "";
  for (const dir of searchPath.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, bin);
    if (existsSync(candidate)) return dir;
  }
  return undefined;
};
