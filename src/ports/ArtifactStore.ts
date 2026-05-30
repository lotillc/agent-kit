/**
 * Artifact persistence port. Default adapter is fs-backed; tests use an in-memory impl.
 *
 * See ADR-0015 (planned @lotiai/agent-kit/testing subpath: InMemoryArtifactStore).
 */
export interface ArtifactStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}
