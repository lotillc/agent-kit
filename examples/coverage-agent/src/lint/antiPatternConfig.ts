import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// Generates a minimal ESLint v9 flat config loading @vitest/eslint-plugin
// with only anti-pattern rules. Run in isolation (--no-config-lookup) against
// the single generated test file passed as CLI argv. The repo as a whole
// still uses Biome.
//
// The plugin and parser are imported by their absolute file:// URLs (not bare
// specifiers), because the config is written to the worktree root where Node
// ESM resolution cannot find deps that pnpm installed only under
// tools/coverage-agent/node_modules.
//
// Sets an explicit `basePath` so ESLint doesn't treat the config file's own
// directory (`.coverage-agent-run/`) as the project root — otherwise any
// target outside that directory is reported as "File ignored because outside
// of base path" and no rules are enforced.
//
// The `files: ["**/*.ts"]` pattern combined with a TypeScript parser is
// required: without them, ESLint reports "File ignored because no matching
// configuration was supplied" for the .vitest.ts target and skips all rules.
export function buildAntiPatternLintConfig(
  vitestPluginUrl: string,
  parserUrl: string,
  basePath: string,
): string {
  return `import vitest from ${JSON.stringify(vitestPluginUrl)};
import parser from ${JSON.stringify(parserUrl)};

export default [
  { basePath: ${JSON.stringify(basePath)} },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    languageOptions: { parser },
    plugins: { vitest },
    rules: {
      "vitest/expect-expect": "error",
      "vitest/no-disabled-tests": "error",
      "vitest/no-identical-title": "error",
      "vitest/no-conditional-expect": "error",
      "vitest/no-commented-out-tests": "error",
      "vitest/valid-expect": "error",
      "vitest/no-standalone-expect": "error",
      // Hard ban on test.fails()/it.fails(). These let green-CI PRs ship
      // tests that bless a latent source bug; the correct pattern is a
      // bare failing test with a matching suspectedBugs entry, which the
      // validate gate recognizes and allows through. See the
      // suspected-bug contract in prompts/suspectedBugContract.ts.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name=/^(test|it|describe|xtest|xit)$/][callee.property.name='fails']",
          message:
            "test.fails()/it.fails() are forbidden. Write a bare failing test(...) with a matching suspectedBugs entry in agent-output.json — see prompts/suspectedBugContract.ts.",
        },
      ],
    },
  },
];
`;
}

export function writeAntiPatternLintConfig(
  path: string,
  vitestPluginUrl: string,
  parserUrl: string,
  basePath: string,
): void {
  writeFileSync(path, buildAntiPatternLintConfig(vitestPluginUrl, parserUrl, basePath), "utf8");
}

export function resolveVitestEslintPluginUrl(): string {
  const require = createRequire(import.meta.url);
  return pathToFileURL(require.resolve("@vitest/eslint-plugin")).href;
}

export function resolveTypescriptEslintParserUrl(): string {
  const require = createRequire(import.meta.url);
  return pathToFileURL(require.resolve("@typescript-eslint/parser")).href;
}

// Returns the absolute path to the ESLint CLI (`bin/eslint.js`). Resolved via
// `eslint/package.json` because the `./bin/eslint.js` subpath is not listed
// in eslint's `exports`. Used to invoke eslint with `node` directly, bypassing
// `pnpm exec` — in ephemeral worktrees pnpm may not hoist the eslint binary
// to the worktree-root `.bin/`.
export function resolveEslintBinPath(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve("eslint/package.json")), "bin", "eslint.js");
}
