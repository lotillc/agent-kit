import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  buildAntiPatternLintConfig,
  resolveEslintBinPath,
  resolveTypescriptEslintParserUrl,
  resolveVitestEslintPluginUrl,
  writeAntiPatternLintConfig,
} from "../lint/antiPatternConfig.js";

const fakePluginUrl = "file:///fake/abs/path/dist/index.cjs";
const fakeParserUrl = "file:///fake/parser/dist/index.js";
const fakeBasePath = "/fake/worktree";

describe("buildAntiPatternLintConfig", () => {
  test("imports the plugin and parser from the provided file URLs", () => {
    const src = buildAntiPatternLintConfig(fakePluginUrl, fakeParserUrl, fakeBasePath);
    expect(src).toContain(`import vitest from "${fakePluginUrl}";`);
    expect(src).toContain(`import parser from "${fakeParserUrl}";`);
  });

  test("enables the full anti-pattern rule set", () => {
    const src = buildAntiPatternLintConfig(fakePluginUrl, fakeParserUrl, fakeBasePath);
    for (const rule of [
      "vitest/expect-expect",
      "vitest/no-disabled-tests",
      "vitest/no-identical-title",
      "vitest/no-conditional-expect",
      "vitest/no-commented-out-tests",
      "vitest/valid-expect",
      "vitest/no-standalone-expect",
    ]) {
      expect(src).toContain(`"${rule}": "error"`);
    }
  });

  test("pins basePath to the given worktree root", () => {
    const src = buildAntiPatternLintConfig(fakePluginUrl, fakeParserUrl, fakeBasePath);
    expect(src).toContain(`basePath: "${fakeBasePath}"`);
  });

  test("wires the TypeScript parser into languageOptions and scopes files to .ts variants", () => {
    const src = buildAntiPatternLintConfig(fakePluginUrl, fakeParserUrl, fakeBasePath);
    expect(src).toContain("languageOptions: { parser }");
    expect(src).toContain(`files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"]`);
  });

  test("bans test.fails()/it.fails() via no-restricted-syntax", () => {
    // Regression fence for PR #2950: the agent was allowed to ship
    // `test.fails(...)` which bless-codified source bugs behind a
    // green-CI PR. The hard gate is an ESLint rule in the anti-pattern
    // lint config — any diff containing a `.fails()` member call on
    // test/it/describe/xtest/xit fails validation before the PR can
    // open. Without this fence, a future edit dropping the rule would
    // silently reopen the loophole.
    const src = buildAntiPatternLintConfig(fakePluginUrl, fakeParserUrl, fakeBasePath);
    expect(src).toContain('"no-restricted-syntax"');
    // The selector must name every test-runner identifier we care about
    // so `it.fails`, `test.fails`, and the skip-style variants all
    // trigger. Matching on `/^(test|it|describe|xtest|xit)$/` is the
    // expression the rule uses.
    expect(src).toContain("/^(test|it|describe|xtest|xit)$/");
    expect(src).toContain("callee.property.name='fails'");
    // And the user-facing message must point at the contract — if the
    // agent hits this rule we want it to know what the right pattern is.
    expect(src).toContain("suspectedBugs entry");
    expect(src).toContain("suspectedBugContract.ts");
  });
});

describe("writeAntiPatternLintConfig", () => {
  test("writes identical content to disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "anti-pattern-config-"));
    const path = join(dir, "eslint.gate.config.mjs");
    try {
      writeAntiPatternLintConfig(path, fakePluginUrl, fakeParserUrl, fakeBasePath);
      expect(readFileSync(path, "utf8")).toBe(
        buildAntiPatternLintConfig(fakePluginUrl, fakeParserUrl, fakeBasePath),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveVitestEslintPluginUrl", () => {
  test("returns a file URL to an on-disk plugin entry", () => {
    const url = resolveVitestEslintPluginUrl();
    expect(url.startsWith("file://")).toBe(true);
    expect(statSync(fileURLToPath(url)).isFile()).toBe(true);
  });
});

describe("resolveTypescriptEslintParserUrl", () => {
  test("returns a file URL to an on-disk parser entry", () => {
    const url = resolveTypescriptEslintParserUrl();
    expect(url.startsWith("file://")).toBe(true);
    expect(statSync(fileURLToPath(url)).isFile()).toBe(true);
  });
});

describe("resolveEslintBinPath", () => {
  test("returns an absolute path to an on-disk eslint CLI entry", () => {
    const path = resolveEslintBinPath();
    expect(path.endsWith("/bin/eslint.js")).toBe(true);
    expect(statSync(path).isFile()).toBe(true);
  });
});
