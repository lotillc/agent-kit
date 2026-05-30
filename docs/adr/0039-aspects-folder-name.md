# ADR-0039 — `aspects/` folder name (not `decorators/`)

- Status: Accepted
- Date: 2026-04-20

## Context

`decorators/` collides with TypeScript's language-level `@decorator` syntax. The folder holds higher-order functions that wrap a ModelRunner or step with one cross-cutting concern each (retry, timeout, cost tracking, logging) — AOP-speak for 'aspects.'

## Decision

Name the folder `aspects/`.

## Consequences

No collision with TS syntax. AOP-accurate name signals intent (cross-cutting concerns, not type-level decorators).
