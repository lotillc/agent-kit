# ADR-0014 — Prompt testing (structure, not prose)

- Status: Accepted
- Date: 2026-04-20

## Context

Prompts churn heavily in early iterations. Snapshotting the full prompt text generates noise and dulls attention to real regressions.

## Decision

Snapshot only prompt structure: section headers, placeholder replacement, conditional-section presence. Do not snapshot prose.

## Consequences

Signal-to-noise stays high. Prompt editors don't trip a test suite every time they rephrase a sentence.
