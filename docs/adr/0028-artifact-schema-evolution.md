# ADR-0028 — Artifact schema evolution

- Status: Accepted
- Date: 2026-04-20

## Context

When the toolkit bumps majors, consumers may still have on-disk artifacts written by the old version. Silent coercion hides bugs; loud failure forces an explicit migration.

## Decision

Every artifact carries a `schemaVersion` field. Toolkit ships a forward-migration helper. Unknown schemas fail loudly with actionable error messages.

## Consequences

Schema drift surfaces immediately. Migrations are explicit and tested.
