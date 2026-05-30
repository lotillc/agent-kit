# ADR-0035 — Versioning path to 1.0

- Status: Accepted
- Date: 2026-04-20

## Context

Pre-1.0 allows breaking changes freely. Declaring 1.0 prematurely locks behavior before the API has been validated by real usage.

## Decision

Stay on 0.x until the public API has stabilized under real usage — no breaking changes needed across consecutive releases. 1.0 signals that stability commitment.

## Consequences

Breaking changes stay cheap while the surface settles; 1.0 carries a real stability guarantee.
