# ADR-0041 — Missing-runner handling (fail-fast)

- Status: Accepted
- Date: 2026-04-20

## Context

A multi-CLI consensus can degrade silently when Codex / Gemini CLIs are missing: it runs with a smaller panel. Unanimous/majority tiers become misleading when half the panel is absent.

## Decision

Fail-fast with `MissingRunnerError`. Consumers opt into degradation via a `withFallback(runner, {onMissing: 'warn'})` aspect.

## Consequences

Misconfig surfaces immediately. Consensus tiers are never silently misleading. Graceful-degrade path is still available, but explicit.
