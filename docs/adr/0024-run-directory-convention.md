# ADR-0024 — Run directory convention

- Status: Accepted
- Date: 2026-04-20

## Context

Consumers write to brand-scoped run directories (e.g. `.my-agent/`, `.my-coverage-run/`). They want to own the top-level name; the toolkit shouldn't.

## Decision

Provide `resolveRunDir(consumerName, runId)` that returns `<consumerName>-run/<runId>/`. Consumer chooses the parent path.

## Consequences

Every consumer gets a deterministic per-run path. Top-level directory name is a consumer decision.
