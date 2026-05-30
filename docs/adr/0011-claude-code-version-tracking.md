# ADR-0011 — Claude Code version-tracking (exact pin)

- Status: Accepted
- Date: 2026-04-20

## Context

`@anthropic-ai/claude-code` is on v2.x and moves fast. Caret ranges mean every consumer picks up version drift independently; pinning centralizes the decision.

## Decision

Exact pin. Agent-kit minor bump when Claude Code patch/minor-bumps; agent-kit major bump when Claude Code major-bumps.

## Consequences

Toolkit becomes the single test point for each Claude Code release. Consumers inherit a vetted combination.
