# ADR-0030 — Consumer env-var prefix (dual)

- Status: Accepted
- Date: 2026-04-20

## Context

A consumer may already use its own `CONSUMER_*` env vars, while toolkit-generic behavior wants `AGENT_KIT_*`. Renaming a consumer's vars is churn; forcing toolkit settings under a consumer prefix is misleading.

## Decision

Dual: `AGENT_KIT_*` for toolkit-generic settings (e.g. `AGENT_KIT_CLAUDE_TIMEOUT_MS`); consumer-specific prefix for domain settings (e.g. `CONSUMER_LOC_BUDGET`).

## Consequences

Minimal churn during migration. Clear ownership of each setting.
