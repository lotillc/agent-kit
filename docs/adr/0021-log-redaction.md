# ADR-0021 — Log redaction (default-on)

- Status: Accepted (2026-05-31; scope clarified)
- Date: 2026-04-20

## Context

API keys and tokens routinely end up in process env, CLI args, and subprocess stderr. Accidental leakage is one noisy grep away.

## Decision

A default-on redactor (`redactSecrets`) scrubs caller-supplied secret values plus common token shapes (Anthropic `sk-ant-`, GitHub `ghp_`/`github_pat_`, AWS `AKIA`, bearer, `x-access-token`) from the Claude runner's log output. It wraps the injected logger, so every stderr line (line-framed so chunk splits don't slip through), stream event, and lifecycle/error message is scrubbed before it lands. Opt-out requires an explicit `disableRedaction: true` flag.

## Consequences

Safe default; consumers rarely override. The pattern set is centralized and testable. Scope is the Claude runner's string log output — consumers that build their own structured loggers scrub their own attribute values.
