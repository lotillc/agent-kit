# ADR-0042 — Retry hierarchy

- Status: Accepted
- Date: 2026-04-20

## Context

Retries can happen at step, workflow, and run levels. Unbounded nesting turns a transient blip into many attempts; inconsistent defaults mean the same failure behaves differently in every consumer.

## Decision

Step default = 3 attempts (`withRetry` aspect). Workflow default = 1 (composer). Run level = consumer-chosen. Defaults documented in README; revisit values after real-world soak.

## Consequences

Multiplicative ceiling is predictable. Values tunable after real usage. Every retry layer is named and separately overridable.
