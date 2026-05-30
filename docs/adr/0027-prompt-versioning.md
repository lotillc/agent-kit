# ADR-0027 — Prompt versioning (per-prompt)

- Status: Accepted
- Date: 2026-04-20

## Context

A single global `PROMPT_VERSION` is common but, in a toolkit serving multiple prompts, makes A/B slicing impossible.

## Decision

Per-prompt version strings. Each prompt builder stamps its own version into the artifact it produces.

## Consequences

Analysts can slice findings by prompt version. Changing one prompt doesn't invalidate another's history.
