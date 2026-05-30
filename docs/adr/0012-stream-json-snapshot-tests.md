# ADR-0012 — Stream-JSON protocol snapshot tests

- Status: Accepted
- Date: 2026-04-20

## Context

Claude Code's stream-json shape has shifted between major versions. A silent regression would break consumers.

## Decision

Ship snapshot tests against recorded stream-json fixtures in `src/__fixtures__/stream-json/`. PRs that bump `@anthropic-ai/claude-code` also update fixtures.

## Consequences

Breaking protocol changes are caught at CI time. Fixture updates are explicit, grep-able, and reviewed.
