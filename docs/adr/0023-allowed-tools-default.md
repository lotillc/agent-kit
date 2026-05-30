# ADR-0023 — Allowed-tools (caller-supplied)

- Status: Accepted (2026-05-31; revised — see below)
- Date: 2026-04-20 (original); 2026-05-31 (current)

## Context

Claude Code's tool allowlist controls what the agent can do. An overly permissive default is a footgun; an overly restrictive one makes every consumer override.

## Decision

The toolkit ships no baked-in allowlist. `allowedTools` is caller-supplied and forwarded to `--allowedTools` only when approval bypass is off (the two are mutually exclusive). A recommended conservative starting set is `Read`, `Glob`, `Grep`, and `Bash` scoped to safe commands (`git`, `pnpm`, `node`, `ls`, `cat`, `grep`, `find`, `wc`); consumers pass and extend it.

## Consequences

Consumers own their tool policy explicitly; no hidden default to reason about. (The original claimed a baked-in default allowlist; revised to match the code, which forwards only what the caller provides.)
