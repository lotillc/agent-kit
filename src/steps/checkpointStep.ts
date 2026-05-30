import type { ArtifactStore } from "../ports/ArtifactStore.js";

/**
 * Serialize a slice of the composer bag to an `ArtifactStore`, enabling
 * resumability in sync execution (async/Temporal mode uses Temporal's native
 * workflow history and does not need this helper).
 *
 * Deliberately not a composer `step()` — it's a plumbing helper that steps
 * (or a consumer wrapper step) invoke. Consumers typically call it inline at
 * the end of a logical phase.
 *
 * Schema is carried by the caller (agent-kit provides `defineArtifact` in
 * `domain/artifacts/`). This helper only serializes; it does NOT validate.
 * Callers that need validation should use `ArtifactDefinition.write` directly.
 *
 * Example:
 * ```ts
 * const checkpoint = makeCheckpoint({ store, key: "phase-plan" });
 * await checkpoint.save(bag);
 * const prior = await checkpoint.load();
 * ```
 */
export interface CheckpointInput<Slice, F extends keyof Slice = keyof Slice> {
  store: ArtifactStore;
  key: string;
  /** Which fields to persist. Omit to serialize the whole bag. */
  fields?: ReadonlyArray<F>;
}

export interface Checkpoint<Slice, F extends keyof Slice = keyof Slice> {
  save(slice: Slice): Promise<void>;
  /**
   * Loads the saved checkpoint. When `fields` was specified at construction,
   * the returned value contains only those fields (typed as `Pick<Slice, F>`).
   * When `fields` was omitted, the full slice is returned. No schema validation
   * — corrupted JSON or non-object values resolve to `null`.
   */
  load(): Promise<Pick<Slice, F> | null>;
  exists(): Promise<boolean>;
}

export const makeCheckpoint = <
  Slice extends Record<string, unknown>,
  F extends keyof Slice = keyof Slice,
>({
  store,
  key,
  fields,
}: CheckpointInput<Slice, F>): Checkpoint<Slice, F> => ({
  save: async (slice) => {
    const payload = fields ? pickFields(slice, fields) : slice;
    await store.write(key, JSON.stringify(payload, null, 2));
  },
  load: async () => {
    const raw = await store.read(key);
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Pick<Slice, F>;
  },
  exists: () => store.exists(key),
});

const pickFields = <Slice extends Record<string, unknown>, F extends keyof Slice>(
  slice: Slice,
  fields: ReadonlyArray<F>,
): Pick<Slice, F> => {
  const out = {} as Pick<Slice, F>;
  for (const field of fields) {
    if (field in slice) {
      out[field] = slice[field];
    }
  }
  return out;
};
