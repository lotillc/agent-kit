# ADR-0003 — GitHub API surface (Octokit + gh-CLI side-by-side)

- Status: Accepted
- Date: 2026-04-20

## Context

Service-style consumers favor Octokit (app-authenticated, rich PR comment APIs). CLI/CI consumers favor the `gh` CLI (simple, CI-friendly). Different deployments want one or the other.

## Decision

Ship both. `adapters/github/` wraps Octokit; `adapters/gh-cli/` wraps the `gh` CLI. Both sit behind the same pure-domain primitives (stacked-PR metadata, branch naming) so consumers pick per deployment shape.

## Consequences

No forced choice, no refactor when a consumer switches. Domain logic is tested once regardless of transport.
