import type { ZodError, ZodIssue, ZodType } from "zod";

import type { ArtifactStore } from "../../ports/ArtifactStore.js";

/**
 * Factory for a schema-validated JSON artifact.
 *
 * Replaces per-artifact `read*` / `write*` boilerplate by deriving it
 * from a single Zod schema.
 *
 * Every artifact is expected to carry a `schemaVersion` field — the toolkit
 * does not enforce the field's presence here (schemas differ), but readers that
 * check it get the migration-safety promised by ADR-0028.
 *
 * Example:
 * ```ts
 * const PlanArtifact = defineArtifact({
 *   key: "plan",
 *   schema: PlanSchema,
 * });
 *
 * await PlanArtifact.write(store, planValue);
 * const plan = await PlanArtifact.read(store); // throws on schema mismatch
 * ```
 */
export interface ArtifactDefinition<T> {
  readonly key: string;
  read(store: ArtifactStore): Promise<T>;
  readOptional(store: ArtifactStore): Promise<T | null>;
  write(store: ArtifactStore, value: T): Promise<void>;
  exists(store: ArtifactStore): Promise<boolean>;
}

export interface DefineArtifactInput<T> {
  key: string;
  schema: ZodType<T>;
}

export const defineArtifact = <T>({
  key,
  schema,
}: DefineArtifactInput<T>): ArtifactDefinition<T> => ({
  key,
  read: async (store) => {
    const raw = await store.read(key);
    if (raw === null) {
      throw new ArtifactNotFoundError(key);
    }
    return parseOrThrow(schema, raw, key);
  },
  readOptional: async (store) => {
    const raw = await store.read(key);
    if (raw === null) {
      return null;
    }
    return parseOrThrow(schema, raw, key);
  },
  write: async (store, value) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new ArtifactParseError(key, result.error.message, {
        cause: result.error,
        issues: result.error.issues,
      });
    }
    await store.write(key, JSON.stringify(result.data, null, 2));
  },
  exists: (store) => store.exists(key),
});

const parseOrThrow = <T>(schema: ZodType<T>, raw: string, key: string): T => {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new ArtifactParseError(key, "invalid JSON", { cause });
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ArtifactParseError(key, result.error.message, {
      cause: result.error,
      issues: result.error.issues,
    });
  }
  return result.data;
};

export class ArtifactNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Artifact not found: ${key}`);
    this.name = "ArtifactNotFoundError";
  }
}

export class ArtifactParseError extends Error {
  public readonly issues: ReadonlyArray<ZodIssue> | undefined;

  constructor(
    public readonly key: string,
    detail: string,
    options?: { cause?: unknown; issues?: ReadonlyArray<ZodIssue> },
  ) {
    super(`Artifact parse failed for ${key}: ${detail}`, { cause: options?.cause });
    this.name = "ArtifactParseError";
    this.issues = options?.issues;
  }
}

/** Re-exported for consumers writing migration logic that inspects ParseError details. */
export type { ZodError, ZodIssue };
