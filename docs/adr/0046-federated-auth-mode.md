# ADR-0046 — Federated auth mode for the Claude CLI

- Status: Accepted
- Date: 2026-09-16
- Amends: [ADR-0020](0020-api-key-handling.md) (adds a third mode to the auth resolution it describes)

## Context

Workload Identity Federation exchanges a short-lived OIDC assertion for an Anthropic token, so CI
can run without a standing API key. Three properties of the Claude CLI shape how it can be used,
all verified empirically against `@anthropic-ai/claude-code` 2.1.163:

- `--bare` reaches only `ANTHROPIC_API_KEY` or an `apiKeyHelper`. It cannot federate, and the
  block keys off the `CLAUDE_CODE_SIMPLE` env var rather than the flag, so there is no way to keep
  minimal mode and federate at once.
- A minted token lives at most ~600s: the lesser of the rule's `token_lifetime_seconds` and twice
  the remaining life of the assertion, which GitHub fixes at 300s. That is shorter than one agent
  lap, so no statically-minted credential works; the CLI must refresh, which it does by re-reading
  the assertion on every exchange.
- Assertions carry a `jti` and are single-use. Two concurrent spawns reading one file present the
  same assertion and the second exchange is rejected as a replay. Observed: two reviewers spawned
  9ms apart, one authenticated and the other failed the run.

## Decision

Add `auth: "federation"`, distinct from `"oauth"` rather than folded into it.

- **Omit `--bare`,** which is what makes federation reachable, and pass no extra args otherwise —
  `--add-dir` exists to restore CLAUDE.md discovery that only `--bare` disables, so it would be a
  no-op here, exactly as under `"oauth"`.
- **Clear every credential the CLI accepts ahead of federation:** `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, and the third-party provider switches
  `CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` / `_FOUNDRY`, which route to another provider on its own
  credentials. An inherited one would win silently and the requested identity would never run.
- **`identityTokenFile` per spawn.** Concurrent callers must each pass their own; omitting it falls
  back to the inherited `ANTHROPIC_IDENTITY_TOKEN_FILE`, which is process-global, so the runner
  warns when that fallback is used.
- **Refuse when no assertion is reachable,** with `FederationConfigError`.
- **`"oauth"` now clears the federation vars too,** so an explicit request for the cached session
  cannot federate off a job-level env var and mislabel itself in the `auth=` log line.

## Consequences

`auth: "auto"` never selects federation — it stays "api key, else cached session". Federation is
always an explicit choice, so a federated environment cannot silently change what an existing
caller does.

Refusing on a missing assertion differs from `"bare"`, which defers to the CLI to error. The
asymmetry is deliberate: without a key the CLI fails loudly on its own, whereas without an
assertion it falls through to a cached session and completes the run under the wrong identity.
Only the second case needs us to refuse.

`AuthResolution.mode` gains a member. It is exported from the root barrel and the
`./agent-cli/claude` subpath, so a consumer assigning it to a narrower type or switching
exhaustively breaks — hence a minor bump, not a patch.

Known gaps, deliberately not closed here:

- `createClaudeCliRunner` (`./runners`) has no federation route; it hard-sets `anthropicApiKey`.
- There is no `identityToken` option for the literal-assertion form, so that form can only come
  from the environment and therefore cannot vary per spawn.
- `apiKeyHelper` configured in user settings is not an env var and cannot be cleared this way.
- `identityTokenFile` is a flat option rather than a `federation: { … }` group. Flat matches the
  existing `anthropicApiKey`; grouping would be preferable if federation gains more fields.
