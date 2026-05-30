# ADR-0036 — In-process Agent SDK alternative (deferred)

- Status: Accepted
- Date: 2026-04-20

## Context

`@anthropic-ai/claude-agent-sdk` (TypeScript, ~v0.2.x) offers in-process primitives (subagent delegation, MCP tools, hooks, sessions). Agent-kit's `adapters/agent-cli/claude/` spawns the CLI instead. Both could co-exist behind the `ModelRunner` port.

## Decision

Deferred. No current need for streaming UIs, hot-reload, or in-process subagents.

## Consequences

`ModelRunner` port stays compatible with a future in-process adapter. Revisit when a consumer surfaces the need.
