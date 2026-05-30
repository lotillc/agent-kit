# ADR-0031 — Consumer `invoke-claude` command (kept, thinned)

- Status: Accepted
- Date: 2026-04-20

## Context

A consumer may ship an `invoke-claude` subcommand. It could be dropped in favor of running the composer workflow directly — but running a single step in isolation is valuable for debugging.

## Decision

Keep the command. Thin it to a wrapper around `runClaudeStep`.

## Consequences

Per-step debug ergonomics preserved. Implementation is a few lines.
