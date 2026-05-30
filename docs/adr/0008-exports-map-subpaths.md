# ADR-0008 — Exports map (subpath exports)

- Status: Accepted
- Date: 2026-04-20

## Context

A single top-level export forces consumers to pull the whole barrel. Subpath exports (common in modern libraries) let consumers pay for only what they use and keep tree-shaking predictable.

## Decision

Publish subpath exports: `@lotiai/agent-kit/ports`, `@lotiai/agent-kit/artifacts`, `@lotiai/agent-kit/process`, and so on as areas land. The top-level barrel re-exports a curated subset.

## Consequences

Smaller consumer bundles. Clearer intent at import sites. Each subpath can evolve its own types without polluting the top level.
