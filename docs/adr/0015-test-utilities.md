# ADR-0015 — Test utilities subpath (`@lotiai/agent-kit/testing`)

- Status: Accepted (planned — not yet shipped)
- Date: 2026-04-20

## Context

Consumers otherwise re-invent an in-memory `ArtifactStore` double. The factory already lives in the toolkit's own tests.

## Decision

Plan to ship `InMemoryArtifactStore`, `recordingSpawn`, and other test doubles from a `@lotiai/agent-kit/testing` subpath. Not yet in the `exports` map; lands when the first external consumer needs it.

## Consequences

Consumer tests stay small. Shared invariants (e.g. `ArtifactStore` semantics) validated once in the toolkit.
