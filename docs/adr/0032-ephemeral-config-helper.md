# ADR-0032 — Ephemeral-config helper

- Status: Accepted
- Date: 2026-04-20

## Context

Generating Stryker and ESLint configs at runtime scoped to a single file is a recurring need; the same pattern suits runtime prompt-fragment configs. It's small but easy to get wrong.

## Decision

Factor out `domain/ephemeralConfig.ts` (file-writing + cleanup-on-exit helper). Stryker/ESLint specifics stay in the consumer; it calls the helper.

## Consequences

Cleanup is centralized. Pattern is reusable without lifting domain-specific configs.
