import { SUSPECTED_BUG_CONTRACT } from "./suspectedBugContract.js";

export interface PromptExemplar {
  repoRelativePath: string;
  source: string;
}

/** Stamped into `run-record.json` so prompt versions can be correlated with outcomes. Bump on non-trivial changes. */
export const PROMPT_VERSION = "v5";

export interface UncoveredRangeHint {
  start: number;
  end: number;
  type: "statement" | "branch";
}

export interface PromptTarget {
  /** Repo-relative path of the source file to cover. */
  repoRelativePath: string;
  /** Source text, injected verbatim inside a fenced block. */
  source: string;
  /** Optional line-level uncovered-range hints (istanbul-derived). */
  uncoveredRanges?: UncoveredRangeHint[];
}

export interface BuildTestGenerationPromptInput {
  repoRoot: string;
  packageName: string;
  pnpmFilter: string;
  /**
   * One or more source files to cover in this run. When `targets.length === 1`
   * the prompt degenerates to a single-file prompt almost identical to the
   * pre-batching output; when N>1 the agent gets per-target blocks plus a
   * per-target quarantine instruction (one failing target doesn't abort the
   * batch).
   */
  targets: PromptTarget[];
  maxTurns: number;
  exemplars: PromptExemplar[];
  /**
   * The canonical "run this test file" command, pre-formatted per the
   * caller's package manager strategy. Injected into the prompt verbatim so
   * Claude always has the right invocation (pnpm/yarn/npm/bun) without us
   * threading package-manager details through the prompt template.
   *
   * The command targets the package's test runner, not an individual test
   * file — the agent fills in specific file paths when iterating. This keeps
   * the command shape identical for N=1 and N>1.
   */
  testCommand: string;
}

const INSTRUCTIONS = `# You are writing unit tests for TypeScript files

Your only job: raise unit-test coverage on <TARGET_COUNT_PHRASE> by creating new Vitest test files. You may iterate until the tests pass.

## Hard rules (non-negotiable)

1. **Test files freely; source edits only to add \`export\`.** You may create or edit files matching \`<packageDir>/src/**/__tests__/**/*.vitest.ts\` or \`<packageDir>/src/**/*.fixtures.ts\`. You may edit the *target source file itself* **only** to add \`export\` (or \`export default\` / \`export async\`) keywords to existing top-level declarations — this makes CLI scripts testable without changing their behavior. You may **not** change logic, add new code, rename, reorder, or touch any other file. A diff gate enforces this: every non-test-file line you modify must differ from the original only by the added \`export\` prefix.
2. **Vitest 4, globals disabled.** Import what you need from \`vitest\` at the top of the file: \`import { describe, test, expect, vi } from "vitest";\`.
3. **Never mock the module under test.** Mock only its external dependencies (AWS SDK clients, fetch, database, etc.), and only when you have to.
4. **No tautological or assertion-free tests.** Every \`test\`/\`it\` block must have at least one \`expect(...)\` that exercises observable behavior. No snapshot-only tests.
5. **Match exemplar style exactly.** The exemplars below are real tests from this package. Mirror their naming, fixture patterns, and \`describe\` nesting. If the exemplars don't mock a given dependency, you shouldn't either.
6. **Module-level side effects:** if importing the target would trigger a top-level \`main()\` or similar, and you can't cleanly mock the side effect through constructor injection / env vars, set that target's outcome to \`gave_up\` (see "When you're done") with a clear rationale. Adding an \`if (require.main === module)\` guard is **not** allowed under the diff rules — only export-keyword additions are.
7. **Constructor mocks must be \`function\` or \`class\`, NOT arrow functions.** When you mock a class (anything the source \`new\`'s, including AWS SDK clients, HTTP clients, \`EventEmitter\` subclasses), vitest 4 writes a stderr warning for arrow-function implementations, and the validate gate treats that warning as fatal. The failure mode:

    \`\`\`ts
    // BAD — arrow function; vitest warns, validate aborts.
    vi.mock("@aws-sdk/client-dynamodb", () => ({
      DynamoDBClient: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
    }));
    \`\`\`

    Two acceptable fixes:

    \`\`\`ts
    // GOOD — classic function() expression
    vi.mock("@aws-sdk/client-dynamodb", () => ({
      DynamoDBClient: vi.fn().mockImplementation(function () {
        return { send: vi.fn().mockResolvedValue({ Items: [] }) };
      }),
    }));

    // GOOD — class-based mock (preferred; typed)
    class MockDynamoDBClient {
      send = vi.fn().mockResolvedValue({ Items: [] });
    }
    vi.mock("@aws-sdk/client-dynamodb", () => ({
      DynamoDBClient: vi.fn<typeof MockDynamoDBClient>().mockImplementation(MockDynamoDBClient),
    }));
    \`\`\`

    Arrow functions are fine for \`vi.fn()\` return-value mocks that are NEVER \`new\`'d (e.g. mocking a plain function). The rule applies **only** when the mocked identifier is a class/constructor.
8. **Never put \`expect(...)\` behind control flow.** The anti-pattern lint gate rejects conditional assertions via \`vitest/no-conditional-expect\`. Do NOT write \`if (...)\`, \`else\`, \`switch\`, or similar branches that contain \`expect(...)\`. Instead, split the scenarios into separate tests, or compute a value first and assert on it unconditionally at the end of the test.
<BATCH_INSTRUCTION>
## Environment (already set up — do NOT modify)

Node, your project's package manager, vitest, and tsx are installed in this worktree. Dependencies have already been installed (frozen lockfile). **You must not:**

- export \`VOLTA_HOME\`, modify \`PATH\`, or invoke \`volta\`, \`nvm\`, or \`fnm\`
- run any dependency install command (\`pnpm install\`, \`npm install\`, \`yarn install\`, \`bun install\`)
- invoke \`node\` directly with inline \`-e\` scripts to probe the environment
- write temporary bash scripts to bootstrap a toolchain

If a command errors with "command not found" or "module not found", the environment is genuinely broken — stop and return \`status: "gave_up"\` with rationale. Do **not** try to fix the environment yourself.

## Workflow

After each round of edits, run the test file(s) with this command shape (substitute the test-file path you just edited):

\`\`\`bash
<TEST_COMMAND>
\`\`\`

Run it verbatim. Do not prepend PATH exports, \`volta run\`, or any other prelude. Do not run \`tsc\`, \`eslint\`, or the full test suite — just the one file above. Fix failures and re-run. You have at most <MAX_TURNS> agentic turns across all targets in this run.

## Cost-aware rules

- If a test keeps failing after ≥2 fix attempts and the source looks fine, follow the suspected-bug protocol below (do not grind).
- If you find yourself re-reading the same exemplar or dependency more than 3 times, stop exploring and commit to what you have — you're thrashing.
- If session duration approaches the turn cap, prioritize finalizing whatever you have. A smaller working test file ships; a large half-baked one does not.

## Suspected-bug protocol

If after ≥2 honest attempts a test still fails AND you believe the assertion is correct (i.e., the *source* has a bug), do NOT:
  - delete the test
  - weaken the assertion to make the current (broken) behavior pass
  - use \`.skip()\`, \`.todo()\`, \`test.fails()\`, \`it.fails()\`, or comments like \`// TODO: fix\`

Instead, keep the correct-behavior assertion as a bare \`test(...)\` and end its name with \`(suspected bug: <reason>)\`. The test will genuinely fail under CI — that's the signal. The pipeline derives the declaration from that name marker and ships the PR with the red test visible so merge is blocked until the source is fixed.

<SUSPECTED_BUG_CONTRACT>

If you exceed the 3-test cap, mark the target as \`gave_up\` instead.

## When you're done

Write a JSON file to \`<REPO_ROOT>/.coverage-agent-run/agent-output.json\` with this exact shape:

\`\`\`json
{
  "status": "success" | "gave_up",
  "filesCreated": ["<repo-relative paths of new test files>"],
  "filesModified": ["<repo-relative paths of edited test files>"],
  "rationale": "One short paragraph: what you did, what you chose not to test, and why.",
  "suspectedBugs": [
    {
      "sourceRepoRel": "packages/alpha/src/foo.ts",
      "testRepoRel": "packages/alpha/src/__tests__/foo.vitest.ts",
      "testName": "returns empty array for null (suspected bug: throws TypeError)",
      "rationale": "Function signature suggests returning T[] for any input; currently throws TypeError on null."
    }
  ]
}
\`\`\`

\`suspectedBugs\` is OPTIONAL and defaults to an empty array. You normally leave it empty — the validate gate derives declarations from any failing test whose name ends with \`(suspected bug: <reason>)\`. Add an explicit entry only if you also want one; the name marker alone is sufficient.

Use \`"status": "gave_up"\` if you can't make **any** file testable without either (a) editing source beyond \`export\` keywords, (b) writing tests that violate the hard rules, or (c) hitting the turn limit with failing tests that are NOT suspected bugs. For a **single** target that turns out untestable in a multi-target run, simply omit that target's test file from \`filesCreated\` / \`filesModified\` — sibling targets still ship. A quarantined file is better than a bad test — be honest.

## What you're testing

Package: \`<PACKAGE_NAME>\`

<TARGETS_SECTION>
## Exemplars from this package (style guide)

<EXEMPLAR_BLOCKS>
`;

const BATCH_INSTRUCTION = `
8. **Per-target quarantine (batch runs).** This run asks you to cover multiple source files in one session. Write one test file per target **independently**. If any single target resists safe coverage (can't avoid mocking the module under test, or requires source edits beyond \`export\`), silently drop that target — omit it from \`filesCreated\` — and move to the next. Do **not** abort the whole session for one bad target. Set \`status: "gave_up"\` only if **no** target shipped.
`;

export function buildTestGenerationPrompt(input: BuildTestGenerationPromptInput): string {
  if (input.targets.length === 0) {
    throw new Error("buildTestGenerationPrompt: targets[] must be non-empty");
  }
  const multi = input.targets.length > 1;
  const targetCountPhrase = multi
    ? `${input.targets.length} specific TypeScript files`
    : "one specific file";
  const batchInstruction = multi ? BATCH_INSTRUCTION : "";
  const exemplarBlocks = input.exemplars
    .map((ex) => `### ${ex.repoRelativePath}\n\n\`\`\`ts\n${ex.source}\n\`\`\`\n`)
    .join("\n");
  return INSTRUCTIONS.replace(/<TEST_COMMAND>/g, input.testCommand)
    .replace(/<REPO_ROOT>/g, input.repoRoot)
    .replace(/<MAX_TURNS>/g, String(input.maxTurns))
    .replace(/<PACKAGE_NAME>/g, input.packageName)
    .replace(/<TARGET_COUNT_PHRASE>/g, targetCountPhrase)
    .replace(/<BATCH_INSTRUCTION>/g, batchInstruction)
    .replace(/<SUSPECTED_BUG_CONTRACT>/g, SUSPECTED_BUG_CONTRACT)
    .replace(/<TARGETS_SECTION>/g, renderTargetsSection(input.targets))
    .replace(/<EXEMPLAR_BLOCKS>/g, exemplarBlocks.trim() || "_no exemplars available_");
}

function renderTargetsSection(targets: PromptTarget[]): string {
  const blocks = targets.map((t, idx) => renderTargetBlock(t, idx, targets.length));
  return blocks.join("\n");
}

function renderTargetBlock(target: PromptTarget, index: number, total: number): string {
  // N=1 keeps the pre-batching heading shape ("Target file: ...") to avoid
  // gratuitous prompt drift for the common single-file path.
  const heading =
    total === 1
      ? `Target file: \`${target.repoRelativePath}\``
      : `### Target ${index + 1} of ${total}: \`${target.repoRelativePath}\``;
  const lines: string[] = [heading, "", "```ts", target.source, "```"];
  const rangesBlock = renderUncoveredRangesBlock(target.uncoveredRanges);
  if (rangesBlock) lines.push(rangesBlock);
  return `${lines.join("\n")}\n`;
}

function renderUncoveredRangesBlock(ranges: UncoveredRangeHint[] | undefined): string {
  if (!ranges || ranges.length === 0) return "";
  const lines = ranges.map((r) => {
    const span = r.start === r.end ? `Line ${r.start}` : `Lines ${r.start}–${r.end}`;
    const label = r.type === "statement" ? "statements" : "branches";
    return `- ${span} (${label})`;
  });
  return `\n#### Uncovered lines

These ranges currently have zero coverage hits. Prioritize assertions that exercise them:

${lines.join("\n")}
`;
}
