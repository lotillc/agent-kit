/**
 * Authentication resolution for the Claude Code CLI.
 *
 * Claude Code has two authentication paths:
 *
 *   - **API key (`--bare`)**: auth strictly via `ANTHROPIC_API_KEY`. Disables
 *     CLAUDE.md auto-discovery (so we re-enable via `--add-dir <cwd>`).
 *     Deterministic billing against a single Anthropic account; right choice
 *     for CI.
 *
 *   - **OAuth (cached session)**: reads `~/.claude/.credentials.json`. Right
 *     choice for local dev on a developer's laptop.
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
export type AuthMode = "bare" | "oauth" | "auto";

export interface AuthResolution {
  mode: "bare" | "oauth";
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
}: ResolveAuthInput): AuthResolution => {
  // Trim and treat empty / whitespace-only values as "no key": Claude reads a
  // blank `ANTHROPIC_API_KEY` as a valid-but-bad key, and a stray newline/space
  // from a CI secret would reach the CLI verbatim and fail auth.
  const explicitKey = trimKey(anthropicApiKey);
  const envKey = trimKey(envApiKey);
  // Explicit arg wins; otherwise the conventional env var selects bare under
  // `auto` (ADR-0020).
  const key = explicitKey ?? envKey;
  const effective: "bare" | "oauth" =
    mode === "auto" ? (key !== undefined ? "bare" : "oauth") : mode;

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

  // OAuth: actively unset the API key env var so Claude Code falls through to
  // the cached OAuth session instead of using a stale key from the shell env.
  return {
    mode: "oauth",
    extraArgs: [],
    envOverrides: { ANTHROPIC_API_KEY: null },
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
