# ADR-0017 — Logging format (structured)

- Status: Accepted
- Date: 2026-04-20

## Context

Service consumers pipe to OTel / CloudWatch. CLIs want readable output. Free-form strings waste both surfaces.

## Decision

Structured JSON (runId, phase, stepName, attrs). Consumer-injected Logger chooses whether to pretty-print.

## Consequences

Services get grep-able logs. CLIs wrap the Logger port with a pretty printer. No consumer-side parsing code needed.
