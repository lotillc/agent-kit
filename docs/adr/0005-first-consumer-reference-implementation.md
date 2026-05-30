# ADR-0005 — First consumer (reference implementation)

- Status: Accepted
- Date: 2026-04-20

## Context

The toolkit needs a real consumer to validate its public surface before it stabilizes — a paper API tends to miss ergonomic and composition gaps.

## Decision

Build (or adopt) one real reference implementation against `@lotiai/agent-kit` and treat it as the canonical example, rather than designing the surface in the abstract.

## Consequences

The public surface is exercised end-to-end before 1.0, and the reference implementation doubles as living documentation for new consumers.
