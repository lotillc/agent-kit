# ADR-0020 — API-key handling (env var honored)

- Status: Accepted (2026-05-31; env-var resolution clarified)
- Date: 2026-04-20

## Context

Secret-manager integrations vary widely; the toolkit can't be opinionated about all of them without coupling to cloud SDKs. The conventional `ANTHROPIC_API_KEY` env var is what the Anthropic SDK and the Claude CLI read by default, so consumers expect exporting it to "just work."

## Decision

Resolve keys from env vars, honoring `ANTHROPIC_API_KEY`. Under `auth: "auto"` (default): an explicit `anthropicApiKey` arg wins; otherwise a non-empty `ANTHROPIC_API_KEY` in the environment selects API-key (`--bare`) auth; with neither, fall back to OAuth. `auth: "bare"` uses a key from arg or env and errors loudly without one; `auth: "oauth"` forces OAuth and unsets the env key (so a stray key can't bypass the chosen session). Consumers resolve secrets from SSM/Vault/etc. and export the env var (or pass it explicitly) before invoking.

## Consequences

Toolkit stays cloud-agnostic; the standard env var works in CI without threading the secret through call sites. Multi-tenant services that must avoid an ambient key pass an explicit per-tenant key (which overrides) or force `auth: "oauth"`. Secret-manager glue lives in consumer bootstrap code.
