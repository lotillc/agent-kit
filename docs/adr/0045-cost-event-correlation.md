# ADR-0045 — Per-run correlation on CostEvent

- Status: Accepted
- Date: 2026-06-01

## Context

`onCost` fires from a registry-global listener, decoupled from any single call's promise chain, and the `CostEvent` carried no correlation back to the call that produced it. A consumer recording every event into a spend ledger could not attribute spend to a unit of work (e.g. a CRISPR incident). Consumer-side AsyncLocalStorage is unreliable because the broadcast is decoupled from the call's async context, and reading the call's return value misses cost from breaker-retried attempts.

## Decision

Add an optional `RunCostContext` (`{ correlationId?; tags? }`) as a 4th argument to `ModelRunner.runReview`/`runGenerate`, threaded through every aspect (breaker, retry, timeout, logging, cost-tracking) down to the provider runners that build the event. The runner stamps it onto the emitted `CostEvent` — on every attempt, including breaker retries — so attribution survives the retry. `CostEvent extends RunCostContext`. `multiModelReview` accepts a `costContext` it forwards to each runner.

Explicit per-call threading (not a global/ALS handle) matches the toolkit's no-globals philosophy (ADR-0025). Fully optional and back-compat: callers that pass nothing emit events with `correlationId`/`tags` undefined, unchanged.

## Consequences

Consumers tag a call and read `event.correlationId` / `event.tags` off `onCost` to roll spend up per unit of work (rollup stays consumer territory, ADR-0018). New optional fields don't break existing listeners or event literals. The 4th param is ignored by `ModelRunner` implementations that don't accept it (parameter-count assignability), so concrete adapters needed no change.
