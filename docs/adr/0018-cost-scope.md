# ADR-0018 — Cost scope (per-step, per-run)

- Status: Accepted
- Date: 2026-04-20

## Context

Cost rollup semantics vary by consumer (e.g. by repo, or by CI workflow run). The toolkit shouldn't encode one.

## Decision

Track per-step and per-run costs in the toolkit. Cumulative rollup (daily budgets, per-repo) is consumer territory.

## Consequences

Toolkit stays scoped. Rollups live wherever they make sense for the consumer.
