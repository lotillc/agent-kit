# @lotiai/agent-kit

Reusable primitives for building agentic harnesses — Claude Code runners, git/github adapters, composer steps, multi-model review.

The common spine that agentic harnesses otherwise reinvent — model runners, git/GitHub plumbing, composable pipeline steps, and multi-model review — behind a small ports/adapters surface.

## Status

Pre-1.0. Independent semver; see [`docs/adr/`](./docs/adr/) for design decisions.

## Design

Two layers over a port surface:

- **`ports/`** — Interfaces only. The injectable seam. Structural subtypes consumers satisfy.
- **`domain/`** — Pure, I/O-free logic. Imports only from `ports/`.
- **`adapters/`** — I/O implementations of ports. Imports node APIs, the `git`/`gh` CLIs, octokit, etc.
- **`steps/`** — composer-compatible step *bodies* (run-functions) that consumers wrap in `@lotiai/composer`'s `step()`.

See [`docs/adr/`](./docs/adr/) for 44 architecture decision records covering every non-trivial choice.

## Subpath exports

Prefer narrow imports over the top-level barrel:

```ts
import { defineArtifact } from "@lotiai/agent-kit/artifacts";
import { defaultSpawn } from "@lotiai/agent-kit/process";
import type { ModelRunner } from "@lotiai/agent-kit/ports";
import type { ReviewFinding } from "@lotiai/agent-kit/review";
```

The top-level `import { ... } from "@lotiai/agent-kit"` re-exports the curated public surface.

## Examples

- [`examples/coverage-agent`](./examples/coverage-agent) — a complete harness
  built on these primitives: selects the highest-value uncovered file, runs
  Claude Code to draft unit tests, gates on coverage/mutation/flake checks,
  runs Claude reviewers (incl. an adversarial pass), and opens a review-ready
  PR. A workspace member, so it always builds against the local source.

## Module format

ESM (`"type": "module"`, `tsconfig` `module: NodeNext`). Relative imports carry `.js` suffixes. Consumes `@lotiai/composer` (CommonJS) via its package name — Node resolves CJS-from-ESM natively.

## Tests

```bash
pnpm test
```

Spawn-touching code takes an injected `SpawnFn`, so most unit tests don't spawn real processes or hit the network; the `defaultSpawn` adapter and a few git/worktree tests do use real short-lived subprocesses / temp dirs. A gated `smoke/` suite that spawns the real Claude CLI is planned (see ADR-0013).

## Dependencies

- `zod` (runtime) — all artifact schemas
- `@lotiai/composer` (optional peer) — orchestration layer for the `steps/` subpath (sync for CLIs, async/Temporal for services)

No heavy internal shared library dep (ADR-0010) so tool CLIs stay lean.
