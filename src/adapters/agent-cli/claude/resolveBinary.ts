import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";

/**
 * Result of resolving the Claude Code CLI entry point.
 *
 * Two shapes exist in the wild:
 *   - **Native binary** (`bin/claude.exe`, v2.1.114+): spawn directly with
 *     the binary path as the command. No node wrapper needed.
 *   - **JS entry** (`cli.js`, v2.1.91 and some current installs): spawn
 *     `process.execPath` (node) with the JS path as the first argument.
 *
 * The resolver picks whichever exists on disk, preferring the native binary
 * when both are present. Exported as a seam so tests can override binary
 * resolution without touching node_modules.
 */
export interface ResolvedBinary {
  /** The command to pass to `spawn`. */
  command: string;
  /** Args to prepend to the user-supplied Claude CLI args. */
  prefixArgs: readonly string[];
}

const localRequire = createRequire(import.meta.url);

/**
 * Default binary resolver. Throws if `@anthropic-ai/claude-code` is not
 * installed or the binary cannot be located.
 */
export const resolveClaudeBinary = (): ResolvedBinary => {
  const pkgJsonPath = localRequire.resolve("@anthropic-ai/claude-code/package.json");
  const pkgDir = dirname(pkgJsonPath);

  // Prefer the native binary when present (v2.1.114+).
  const nativeCandidate = resolvePath(pkgDir, "bin", "claude.exe");
  if (existsSync(nativeCandidate)) {
    return { command: nativeCandidate, prefixArgs: [] };
  }

  // Fall back to the `bin` field in package.json (cli.js on v2.1.91, or
  // whatever future versions declare). Invoke via node.
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
    bin?: string | Record<string, string>;
  };
  const binEntry = pkgJson.bin;
  const binRelative =
    typeof binEntry === "string"
      ? binEntry
      : binEntry
        ? (binEntry.claude ?? binEntry.code)
        : undefined;
  if (!binRelative) {
    throw new Error(
      "@anthropic-ai/claude-code package.json has no `bin` entry — cannot resolve Claude CLI.",
    );
  }

  const jsEntry = resolvePath(pkgDir, binRelative);
  if (!existsSync(jsEntry)) {
    throw new Error(`Claude CLI entry not found at ${jsEntry} (from package.json bin).`);
  }

  return { command: process.execPath, prefixArgs: [jsEntry] };
};
