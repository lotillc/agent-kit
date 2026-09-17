/**
 * Authentication resolution for the Claude Code CLI.
 *
 * Claude Code has three authentication paths:
 *
 *   - **API key (`--bare`)**: auth strictly via `ANTHROPIC_API_KEY`. Disables
 *     CLAUDE.md auto-discovery (so we re-enable via `--add-dir <cwd>`).
 *     Deterministic billing against a single Anthropic account; right choice
 *     for CI.
 *
 *   - **OAuth (cached session)**: reads `~/.claude/.credentials.json`. Right
 *     choice for local dev on a developer's laptop.
 *
 *   - **Federation**: the CLI exchanges an OIDC assertion for a short-lived
 *     Anthropic token and refreshes it on its own. Mutually exclusive with
 *     `--bare`, which reaches only `ANTHROPIC_API_KEY`. Each concurrent spawn
 *     needs its OWN `identityTokenFile`: assertions are single-use by `jti`, so
 *     two processes sharing one file collide on the second exchange.
 *
 * Key precedence under `auto`: an explicit `anthropicApiKey` arg wins; otherwise
 * a non-empty `ANTHROPIC_API_KEY` in the environment selects `bare` (honoring
 * the conventional env var — ADR-0020); with neither, `auto` falls back to
 * OAuth. Pass `auth: "oauth"` explicitly to force OAuth even when a key is set.
 *
 * Precedence trap: without `--bare`, Claude Code prefers `ANTHROPIC_API_KEY`
 * when it's set in the child's env, silently bypassing the OAuth session. So to
 * honor an explicit "use OAuth" choice we actively **unset** the env var the
 * child would otherwise inherit — setting `""` doesn't help; Claude reads that
 * as a valid-but-bad key.
 */
export type AuthMode = "bare" | "oauth" | "auto" | "federation";

/**
 * `auth: "federation"` was requested with no reachable OIDC assertion. Distinct from the
 * `bare` branch, which defers to the CLI: without an assertion the CLI silently falls
 * through to a cached session instead of failing, so this one has to refuse.
 */
export class FederationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FederationConfigError";
  }
}

export interface AuthResolution {
  mode: "bare" | "oauth" | "federation";
  /** Extra CLI args to insert before `-p` / output-format flags. */
  extraArgs: readonly string[];
  /** Env-var mutations to apply to the child's env. `null` = unset that var. */
  envOverrides: Record<string, string | null>;
}

export interface ResolveAuthInput {
  mode: AuthMode;
  cwd: string;
  /** Explicit API key from the caller. Overrides any env key. */
  anthropicApiKey?: string;
  /** `ANTHROPIC_API_KEY` observed in the environment; passed in so this stays pure. */
  envApiKey?: string;
  /**
   * Path the CLI reads its OIDC assertion from, under `auth: "federation"`.
   *
   * Assertions are single-use by `jti`, so **concurrent spawns must each pass a distinct
   * path**. Omitting this falls back to the inherited `ANTHROPIC_IDENTITY_TOKEN_FILE`,
   * which is process-global: two concurrent spawns then present the same assertion and the
   * second exchange is rejected as a replay. The fallback is safe only for one spawn at a
   * time; `runClaudeCode` warns when it is used.
   */
  identityTokenFile?: string;
  /** `ANTHROPIC_IDENTITY_TOKEN_FILE` observed in the environment; passed in so this stays pure. */
  envIdentityTokenFile?: string;
  /** `ANTHROPIC_IDENTITY_TOKEN` observed in the environment; the literal-assertion alternative. */
  envIdentityToken?: string;
}

/** Trim a key and treat an empty / whitespace-only value as absent. */
const trimKey = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

export const resolveAuth = ({
  mode,
  cwd,
  anthropicApiKey,
  envApiKey,
  identityTokenFile,
  envIdentityTokenFile,
  envIdentityToken,
}: ResolveAuthInput): AuthResolution => {
  // Trim and treat empty / whitespace-only values as "no key": Claude reads a
  // blank `ANTHROPIC_API_KEY` as a valid-but-bad key, and a stray newline/space
  // from a CI secret would reach the CLI verbatim and fail auth.
  const explicitKey = trimKey(anthropicApiKey);
  const envKey = trimKey(envApiKey);
  // Explicit arg wins; otherwise the conventional env var selects bare under
  // `auto` (ADR-0020).
  const key = explicitKey ?? envKey;
  const effective: "bare" | "oauth" | "federation" =
    mode === "auto" ? (key !== undefined ? "bare" : "oauth") : mode;

  if (effective === "federation") {
    // Without an assertion the CLI has nothing to exchange, and since federation omits
    // `--bare` it would fall through to a cached OAuth session and run as whoever that
    // is. Refusing is the only outcome that cannot silently use the wrong identity.
    const tokenFile = trimKey(identityTokenFile) ?? trimKey(envIdentityTokenFile);
    if (tokenFile === undefined && trimKey(envIdentityToken) === undefined) {
      throw new FederationConfigError(
        'auth: "federation" requires an identity token: pass identityTokenFile, or set ' +
          "ANTHROPIC_IDENTITY_TOKEN_FILE or ANTHROPIC_IDENTITY_TOKEN in the environment.",
      );
    }
    // Every credential the CLI accepts ahead of federation is cleared, plus the
    // third-party provider switches -- those route to Bedrock/Vertex/Foundry on their own
    // credentials, so an inherited one would ignore the assertion with nothing failing.
    // No `--add-dir`: only `--bare` disables CLAUDE.md discovery, and cwd is already the
    // spawn directory, so it would be a no-op here exactly as it is under `oauth`.
    return {
      mode: "federation",
      extraArgs: [],
      envOverrides: {
        ANTHROPIC_API_KEY: null,
        ANTHROPIC_AUTH_TOKEN: null,
        CLAUDE_CODE_OAUTH_TOKEN: null,
        CLAUDE_CODE_USE_BEDROCK: null,
        CLAUDE_CODE_USE_VERTEX: null,
        CLAUDE_CODE_USE_FOUNDRY: null,
        ...(tokenFile === undefined ? {} : { ANTHROPIC_IDENTITY_TOKEN_FILE: tokenFile }),
      },
    };
  }

  if (effective === "bare") {
    // Set the (trimmed) key explicitly rather than inheriting the raw env var.
    // With no key from either source, unset so the CLI errors loudly instead of
    // half-authenticating.
    const envOverrides: Record<string, string | null> =
      key !== undefined ? { ANTHROPIC_API_KEY: key } : { ANTHROPIC_API_KEY: null };
    return {
      mode: "bare",
      extraArgs: ["--bare", "--add-dir", cwd],
      envOverrides,
    };
  }

  // OAuth: actively unset every credential the child would otherwise inherit, so the
  // cached session is what runs. The federation vars are included because they are exactly
  // that class of credential -- a federated CI job exports them at job level, and without
  // this an explicit `auth: "oauth"` would federate anyway and the `auth=oauth` log line
  // would name an identity that never ran.
  return {
    mode: "oauth",
    extraArgs: [],
    envOverrides: {
      ANTHROPIC_API_KEY: null,
      ANTHROPIC_IDENTITY_TOKEN_FILE: null,
      ANTHROPIC_IDENTITY_TOKEN: null,
    },
  };
};

/**
 * Apply an AuthResolution's env overrides to a base env. `null` values remove
 * the key; strings set it. Returns a new env object; does not mutate `base`.
 */
export const applyEnvOverrides = (
  base: NodeJS.ProcessEnv,
  overrides: Record<string, string | null>,
): NodeJS.ProcessEnv => {
  const out: NodeJS.ProcessEnv = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete out[key];
    } else {
      out[key] = value;
    }
  }
  return out;
};
