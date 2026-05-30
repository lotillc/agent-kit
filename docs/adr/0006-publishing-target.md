# ADR-0006 — Publishing target (public npm)

- Status: Accepted (2026-05-30; supersedes the original private-registry decision)
- Date: 2026-04-20 (original); 2026-05-30 (current)

## Context

`@lotiai/composer` was extracted into a standalone open-source repo and is published to **public npm** via GitHub Actions using a Trusted Publisher (OIDC) configuration with provenance. Agent-kit follows the same pattern.

## Decision

Publish `@lotiai/agent-kit` to **public npm** (`https://registry.npmjs.org`, `access: public`) from this standalone repo. Releases are cut by pushing a `vX.Y.Z` tag, which triggers `release.yml`: it verifies the tag matches `package.json`, then runs `pnpm publish --provenance` authenticated by npm Trusted Publishing (no long-lived `NPM_TOKEN`).

## Consequences

External agents and forks can consume the package directly from public npm with verifiable provenance. No per-package release tooling to invent; the release path mirrors composer's.

## History

The original decision (2026-04-20) published to the GitHub npm registry to match composer's then-current pattern. After composer moved to public npm, agent-kit followed; this ADR was revised on 2026-05-30 to record that flip.
