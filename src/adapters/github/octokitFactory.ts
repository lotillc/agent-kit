/**
 * Octokit factory port. We deliberately don't bundle `@octokit/rest` or
 * `@octokit/auth-app` — consumers that want Octokit can supply their own
 * factory. A long-running service consumer is a concrete consumer that will
 * plug in during migration.
 *
 * Typed as `OctokitLike` (the port) to keep the toolkit free of
 * direct dependency on the Octokit packages.
 */
import type { OctokitLike } from "../../ports/OctokitLike.js";

export interface OctokitFactoryConfig {
  /** GitHub App ID. */
  appId: string;
  /** PEM-encoded private key. */
  privateKey: string;
  /** Optional base URL override (enterprise GitHub). */
  baseUrl?: string;
}

/**
 * Factory interface the consumer implements and supplies. Agent-kit never
 * constructs an Octokit itself in v1.
 */
export interface OctokitFactory {
  /** Create a JWT-authenticated app-level Octokit instance. */
  createAppOctokit(config: OctokitFactoryConfig): OctokitLike;
  /** Create an installation-scoped Octokit instance. */
  createInstallationOctokit(config: OctokitFactoryConfig, installationId: number): OctokitLike;
}
