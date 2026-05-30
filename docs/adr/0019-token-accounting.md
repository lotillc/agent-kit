# ADR-0019 — Token accounting (per-model preserved)

- Status: Accepted
- Date: 2026-04-20

## Context

Claude Code's stream-json reports per-model usage (used when multiple model ids appear in one run). Aggregating away the breakdown loses information that PR bodies and metrics dashboards want.

## Decision

Preserve per-model breakdown all the way to PR body / metrics artifact. Aggregated totals are views, not canonical storage.

## Consequences

Analysts can slice by model. Consumers that only want totals sum the breakdown at render time.
