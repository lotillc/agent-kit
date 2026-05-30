# ADR-0013 — Test strategy (unit-only + gated smoke)

- Status: Accepted (2026-05-31; smoke suite marked not-yet-shipped)
- Date: 2026-04-20

## Context

Real-spawn tests are slow and flaky in CI. The `SpawnFn` port exists to make unit tests hermetic.

## Decision

Unit-only in the normal test suite. Spawn-touching code accepts an injected `SpawnFn` so consumer logic is tested hermetically; the `defaultSpawn` adapter itself is the one place exercised against real short-lived `node` subprocesses. A gated smoke suite that spawns the real Claude CLI (skipped without `ANTHROPIC_API_KEY`) is planned but **not yet shipped**.

## Consequences

Fast, deterministic CI without real model calls. A few git/worktree tests use real temp directories for fidelity; everything else is in-memory. Real end-to-end behavior will be validated by the smoke suite once it lands.
