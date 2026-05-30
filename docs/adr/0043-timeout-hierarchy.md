# ADR-0043 — Timeout hierarchy

- Status: Accepted (2026-05-31; validation claim corrected)
- Date: 2026-04-20

## Context

If an outer timeout fires before an inner one, useful error context is truncated. Misordered timeouts are a subtle bug, so the ordering is documented as an explicit contract.

## Decision

Documented relationship: `stepTimeoutMs ≤ workflowTimeoutMs ≤ runTimeoutMs`. `RunContext` is an interface, so the toolkit does not auto-validate the ordering on construction; consumers assemble their timeouts in this order. The multi-model review path aborts a runner's signal when its per-runner deadline fires, so a timed-out call is cancelled rather than left running.

## Consequences

The hierarchy is a documented contract, not a runtime guard. (A `validateTimeouts` helper can be added later if a single construction site emerges.)
