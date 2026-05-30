import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";

import { describe, expect, test } from "vitest";

import { resolveClaudeBinary } from "../resolveBinary.js";

describe("resolveClaudeBinary", () => {
  test("resolves against the installed @anthropic-ai/claude-code package", () => {
    const resolved = resolveClaudeBinary();
    expect(resolved.command).toBeTruthy();

    // Figure out which shape the installed version has on disk so we can
    // assert the correct branch ran. v2.1.91 ships `cli.js`; v2.1.114+ ships
    // `bin/claude.exe`. The test passes under both by checking which file
    // exists and cross-referencing against the resolver's output.
    const localRequire = createRequire(import.meta.url);
    const pkgJsonPath = localRequire.resolve("@anthropic-ai/claude-code/package.json");
    const pkgDir = dirname(pkgJsonPath);
    const hasNative = existsSync(resolvePath(pkgDir, "bin", "claude.exe"));

    if (hasNative) {
      // Native binary path: command is the binary itself; no prefix args.
      expect(resolved.prefixArgs).toEqual([]);
      expect(resolved.command).toMatch(/claude\.exe$/);
    } else {
      // JS entry path: command is node, prefixArgs[0] is a .js file that exists.
      expect(resolved.command).toBe(process.execPath);
      expect(resolved.prefixArgs).toHaveLength(1);
      expect(resolved.prefixArgs[0]).toMatch(/\.js$/);
      expect(existsSync(resolved.prefixArgs[0]!)).toBe(true);
    }
  });
});
