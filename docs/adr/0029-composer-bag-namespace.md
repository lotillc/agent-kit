# ADR-0029 — Composer bag namespace (`_toolkit.` prefix)

- Status: Accepted
- Date: 2026-04-20

## Context

Consumers compose toolkit steps with their own custom steps. Bag field collisions would be silent overwrites.

## Decision

Toolkit steps read/write fields under a `_toolkit.` prefix. Consumers own the un-prefixed namespace and may alias toolkit fields via shim steps.

## Consequences

Zero collision risk. Consumers can introspect what the toolkit owns at a glance.
