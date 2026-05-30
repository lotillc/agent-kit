# ADR-0033 — GitHub Actions reusable workflows (deferred)

- Status: Accepted
- Date: 2026-04-20

## Context

The toolkit could ship reusable Actions (e.g. `@agent-kit/.github/actions/run-agent@v1`). Shipping one before there is real demand risks baking in a shape that doesn't fit how consumers actually wire CI.

## Decision

Deferred. Revisit once there is concrete demand for a shared workflow shape.

## Consequences

Avoids shipping an Action that may never fit real usage. The revisit trigger is explicit.
