# ADR-0002 — Claude Code source (dependency, not vendored)

- Status: Accepted
- Date: 2026-04-20

## Context

Agentic harnesses either vendor or depend on `@anthropic-ai/claude-code`. Vendoring avoids version drift; depending gives one pin point.

## Decision

Declare `@anthropic-ai/claude-code` as a direct dependency of `@lotiai/agent-kit`. The toolkit owns the pin; consumers get whatever version the toolkit ships with.

## Consequences

The package's `pnpm.onlyBuiltDependencies` entry stays configured so the CLI native binary installs. When Claude Code ships a breaking change, only the toolkit needs retargeting.
