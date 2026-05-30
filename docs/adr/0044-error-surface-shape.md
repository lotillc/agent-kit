# ADR-0044 — Error-surface shape (throw + Result)

- Status: Accepted
- Date: 2026-04-20

## Context

JavaScript idiom says throw. Explicit Result types are grep-able but add ceremony. Mixing ad hoc is worse than picking a clear rule.

## Decision

Throw for exceptional errors (spawn failure, timeout, schema violation). `Result<T, E>` for structured outcomes consumers branch on (`validateDiff` ok/disallowed, `applyFindings` blocked/downgraded, `multiModelReview` per-runner failure records).

## Consequences

Consumers know where to look: try/catch for infra failure, pattern match for business outcomes. A discriminated-union convention consumers can pattern-match on.
