/**
 * Structural subtype of @octokit/rest's Octokit instance.
 *
 * Narrowing is deferred: `rest` and `paginate` are typed `unknown` until a
 * concrete in-toolkit adapter (Octokit-backed PR creation, comments,
 * reviews) needs them. Consumers using the `adapters/github/` factory
 * receive a real `@octokit/rest` Octokit and can call `.rest.*` directly;
 * this port exists for cases where a consumer wants to inject a stub or a
 * partial mock without pulling the full Octokit type into a test.
 */
export interface OctokitLike {
  readonly rest: unknown;
  readonly paginate: unknown;
}
