// Isolate unit tests from the host shell and CI injection by pinning the
// GitHub Actions / Claude env vars this agent reads to empty strings before any
// test runs. Mirrors the env isolation the monorepo provided via its shared
// vitest setup. Per-test `vi.stubEnv` still overrides these (and is restored by
// `unstubEnvs`). Notably, code reads `process.env.GITHUB_SHA ?? headSha(...)`:
// an empty string short-circuits the `??`, so tests don't shell out to git.
for (const key of ["ANTHROPIC_API_KEY", "GITHUB_SHA", "GITHUB_STEP_SUMMARY", "NODE_OPTIONS"]) {
  process.env[key] = "";
}
