# ADR-0010 — Shared-library dependency (zero)

- Status: Accepted
- Date: 2026-04-20

## Context

Heavy shared service libraries pull in AWS SDK, OpenTelemetry, and other service-oriented dependencies. Lean CLIs don't want that tail.

## Decision

Zero dependency on any heavy shared library. Logger and Metrics are ports; consumers inject whatever implementation they want. Services adapt their own shared library at the call site (~3 lines).

## Consequences

Tool CLIs stay lean. Services still wire OTel in a few lines. No bridge package to maintain.
