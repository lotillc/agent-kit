# ADR-0025 — Multi-run isolation

- Status: Accepted
- Date: 2026-04-20

## Context

A service consumer may handle many runs concurrently in one process. Two runs colliding on disk or shared state would be a silent correctness bug.

## Decision

Every on-disk path includes `runId`. No shared mutable state inside the toolkit. Caller-provided config is frozen on ingest. `RunContext` is the only carrier of ambient state.

## Consequences

Concurrent runs are safe by construction. Tests parallelize freely.
