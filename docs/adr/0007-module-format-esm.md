# ADR-0007 — Module format (ESM)

- Status: Accepted
- Date: 2026-04-20

## Context

ESM is the industry standard for new packages. Pre-1.0 with no consumers is the right window to commit to it.

## Decision

ESM-only: `"type": "module"`, `tsconfig` `module: NodeNext`, `moduleResolution: NodeNext`. All relative imports carry `.js` suffixes.

## Consequences

Consumers must import `@lotiai/agent-kit` by its package name (works from both CJS and ESM). `@lotiai/composer` (CJS) is consumed normally via Node's CJS-from-ESM interop. Any package that wants the toolkit can consume it from ESM immediately; CJS consumers use the dual-package interop Node ships.
