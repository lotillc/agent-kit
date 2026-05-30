# ADR-0016 — Event taxonomy (past-tense)

- Status: Accepted
- Date: 2026-04-20

## Context

`RunContext` events are a public API — every consumer will listen. Past-tense naming makes producer/consumer contracts unambiguous (the event describes something that happened).

## Decision

All events past-tense. Initial set: `phase.started`, `phase.completed`, `phase.failed`, `claude.turn_started`, `claude.turn_completed`, `cost.recorded`, `cost.budget_exceeded`, `finding.detected`, `pr.opened`, `worktree.created`, `worktree.cleaned_up`. Zod-validated union.

## Consequences

Events are stable API. Listener code reads naturally. New event types require a new ADR.
