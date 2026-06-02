# coverage-agent (example)

A complete, real-world harness built on `@lotiai/agent-kit`: it picks the
highest-value uncovered source file in a repo, runs Claude Code headless to
draft unit tests for it, gates the result on coverage / mutation / flake
checks, has Claude reviewers (including an adversarial second pass) critique and
fix the tests, and opens a review-ready PR. Nothing merges automatically.

This is a reference implementation, not a published package. It lives in the
agent-kit repo as a workspace member so it always builds against the local
agent-kit source.

## What it demonstrates

The agent-kit primitives this example exercises, by subpath:

- `@lotiai/agent-kit/steps` — `createWorktreeStepRun`, `runClaudeStepRun`:
  spin up an ephemeral git worktree and run Claude Code in it with a prompt,
  turn/cost caps, and streamed JSON logs.
- `@lotiai/agent-kit/agent-cli/claude` — `runAgenticClaude`, `AuthMode`: the
  Claude Code runner used by the reviewers.
- `@lotiai/agent-kit/review` — `Reviewer`/`ReviewInput` ports plus
  `blockingFindings` / `addressableFindings` to drive the review + fix loop.
- `@lotiai/agent-kit/git` — worktree preflight/cleanup, `headSha`,
  `restoreFiles`.
- `@lotiai/agent-kit/gh-cli` — `listOpenPrs` for the PR-stacking gate.
- `@lotiai/agent-kit/process` — `defaultSpawn`, the injectable `SpawnFn` seam.
- `@lotiai/agent-kit/ports` — the structural interfaces everything is typed
  against.

It also shows the surrounding plumbing you need around agent-kit for a
production agent: deterministic target selection, Stryker mutation baselines,
anti-pattern linting of generated tests, artifact files between pipeline steps,
and PR stacking.

## How it runs

`src/index.ts` is a `yargs` CLI. The `pipeline` command chains the steps end to
end (baseline -> select -> doctor -> stryker-baseline -> invoke-claude ->
review-and-fix -> validate -> open-pr); each step is also runnable standalone
(`select`, `invoke-claude`, `validate`, `review`, `summary`, ...). See
`package.json` scripts.

## Run it locally

From the agent-kit repo root (Node >= 24, pnpm 10.28.2):

```bash
pnpm install
pnpm compile                              # build agent-kit dist first
pnpm --filter coverage-agent run compile  # type-check the example
pnpm --filter coverage-agent run test     # run the example's unit tests
pnpm --filter coverage-agent run doctor   # verify prerequisites (git, pnpm, vitest, stryker)
```

A real run needs `ANTHROPIC_API_KEY` (Claude Code) and, to open a PR,
`GH_TOKEN`. Use `COVERAGE_AGENT_DRY_RUN=true` to exercise selection only,
without invoking Claude or opening a PR.

## Configuration

The agent is driven entirely by environment variables (no repo-specific code) —
LOC budget, model overrides, turn/cost caps, reviewer set, isolation mode,
allowed base branches, and more. The schema and every default live in
[`src/config.ts`](./src/config.ts).

## CI

[`coverage-agent.workflow.yml.example`](./coverage-agent.workflow.yml.example)
is a neutralized reference of the scheduled GitHub Actions workflow that runs
the pipeline. It is intentionally **not** under `.github/workflows/` so it never
runs in this repo — copy it into the target repository and fill in the
placeholders.

## Copying this out as a template

This package depends on agent-kit via `"@lotiai/agent-kit": "workspace:*"`,
which only resolves inside this repo. When you copy it into your own project,
swap that for a published range, e.g. `"@lotiai/agent-kit": "^0.1.0"`.
