# ADR-0009 — Node floor (Node 24)

- Status: Accepted
- Date: 2026-04-20

## Context

Node 24 is current. Supporting older Node versions adds maintenance and test cost for no pre-1.0 benefit.

## Decision

Node 24 minimum. `engines.node: >=24` in package.json; CI tests on Node 24.

## Consequences

Uses modern APIs (readline/promises, disposables) freely.
