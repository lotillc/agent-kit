# Security policy

## Trust chain

This package is published and distributed under multiple identifiers. Auditors and consumers should verify the following mapping is consistent before trusting a release:

| Layer | Identifier |
|---|---|
| npm scope | [`@lotiai`](https://www.npmjs.com/org/lotiai) |
| npm package | [`@lotiai/agent-kit`](https://www.npmjs.com/package/@lotiai/agent-kit) |
| GitHub org | [`lotillc`](https://github.com/lotillc) |
| GitHub repo | [`lotillc/agent-kit`](https://github.com/lotillc/agent-kit) |
| Maintainer (legal) | Loti AI, Inc. |
| Maintainer (web) | [lotiai.com](https://lotiai.com) |

The `@lotiai` npm scope and the `lotillc` GitHub org are intentionally distinct names — `@loti` was already taken on npm when these packages were first published, and the `lotillc` GitHub org predates the rebrand to "Loti AI". Both identifiers are owned by the same legal entity.

## Release integrity

Releases are published exclusively from GitHub Actions in [`lotillc/agent-kit`](https://github.com/lotillc/agent-kit) using a [Trusted Publisher](https://docs.npmjs.com/trusted-publishers) configuration with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) enabled. Every published version on npm should:

1. Carry a `provenance` attestation linking back to a specific tag and workflow run in `lotillc/agent-kit`.
2. Match a git tag of the form `vX.Y.Z` on `main`.
3. Have `package.json` `version` equal to the tag (verified by the release workflow before publishing).

If you find an `@lotiai/agent-kit` version on npm that does not satisfy all three properties, treat it as suspect and report it.

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security reports.

Use GitHub's private vulnerability reporting at https://github.com/lotillc/agent-kit/security/advisories/new.

We aim to respond within 5 business days and to publish a fix or mitigation within 30 days for confirmed vulnerabilities.
