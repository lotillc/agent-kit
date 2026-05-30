# ADR-0037 — MCP server surface (deferred)

- Status: Accepted
- Date: 2026-04-20

## Context

Toolkit steps could be exposed as MCP tools so other agents can invoke them. The composer `step` interface is structurally close to the shape MCP tools take.

## Decision

Deferred. No current need.

## Consequences

Composer step shape stays forward-compatible. Revisit when a consumer wants to expose toolkit primitives across an MCP boundary.
