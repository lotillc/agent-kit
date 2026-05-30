# ADR-0004 — Orchestrator (`@lotiai/composer` as optional peer)

- Status: Accepted (2026-05-31; peer clarified as optional)
- Date: 2026-04-20

## Context

`@lotiai/composer` is a DAG generator with sync (in-proc) and async (Temporal) execution modes. It provides typed bag flow, fan-out, retries, schedules. Agent pipelines are a natural fit.

## Decision

Depend on `@lotiai/composer` as an **optional** peer dependency. The `steps/` subpath ships composer-compatible step *bodies* (plain run-functions) that consumers wrap in composer's `step()`; the toolkit imports no composer code at runtime, so consumers using only the runners, git, or review primitives don't need it installed. Those who use `steps/` add composer themselves.

## Consequences

No install friction for non-step consumers. Step users bring composer (sync in-proc for CLIs, async/Temporal for services) and wrap the shipped step bodies. The toolkit owns no state machine of its own.
