# ADR-0026 — Worktree cleanup ownership

- Status: Accepted
- Date: 2026-04-20

## Context

If a pipeline crashes mid-flight, orphaned worktrees accumulate on disk. Long-running services see this in practice.

## Decision

`createWorktreeStep` registers an on-failure cleanup callback with composer. Partial pipelines always clean up.

## Consequences

No orphan worktrees. Cleanup is consistent across sync and async modes.
