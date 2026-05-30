# ADR-0001 — Package name

- Status: Accepted
- Date: 2026-04-20

## Context

Two naming candidates were considered: a descriptive `agentic-toolkit` and the shorter `agent-kit` (which mirrors Anthropic's `@anthropic-ai/claude-agent-sdk` vocabulary). Every consumer types this import path many times.

## Decision

`@lotiai/agent-kit`.

## Consequences

Short, recognizable, aligned with the industry 'agent SDK / kit' nomenclature emerging in 2026. Aliases do not need to be set up.
