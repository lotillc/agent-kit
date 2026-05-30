# ADR-0038 — Session / persistent memory (deferred)

- Status: Accepted
- Date: 2026-04-20

## Context

Claude Agent SDK offers append-oriented session storage + persistent memory across runs. Toolkit today rebuilds state per run via artifacts.

## Decision

Deferred. No current need for cross-run learning.

## Consequences

Artifact-based checkpointing remains the default. Revisit when a consumer (e.g. a feedback-remembering review bot) needs durable memory.
