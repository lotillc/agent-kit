import { describe, expect, test } from "vitest";
import { z } from "zod";

import type { ArtifactStore } from "../../../ports/ArtifactStore.js";
import { ArtifactNotFoundError, ArtifactParseError, defineArtifact } from "../defineArtifact.js";

const createMemoryStore = (): ArtifactStore => {
  const map = new Map<string, string>();
  return {
    read: async (key) => map.get(key) ?? null,
    write: async (key, value) => {
      map.set(key, value);
    },
    exists: async (key) => map.has(key),
    delete: async (key) => {
      map.delete(key);
    },
  };
};

const PlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  title: z.string(),
  steps: z.array(z.string()),
});

const PlanArtifact = defineArtifact({ key: "plan", schema: PlanSchema });

describe("defineArtifact", () => {
  test("write then read round-trips", async () => {
    const store = createMemoryStore();
    const value = { schemaVersion: 1 as const, title: "demo", steps: ["a", "b"] };

    await PlanArtifact.write(store, value);
    const readBack = await PlanArtifact.read(store);

    expect(readBack).toStrictEqual(value);
  });

  test("write validates against schema (strict object rejects extras)", async () => {
    const store = createMemoryStore();

    await expect(
      PlanArtifact.write(store, {
        schemaVersion: 1,
        title: "demo",
        steps: [],
        // @ts-expect-error — exercising runtime rejection
        extra: "nope",
      }),
    ).rejects.toThrow();
  });

  test("read throws ArtifactNotFoundError when key is absent", async () => {
    const store = createMemoryStore();
    await expect(PlanArtifact.read(store)).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });

  test("readOptional returns null when key is absent", async () => {
    const store = createMemoryStore();
    const result = await PlanArtifact.readOptional(store);
    expect(result).toBeNull();
  });

  test("read throws ArtifactParseError on invalid JSON", async () => {
    const store = createMemoryStore();
    await store.write("plan", "not json");
    await expect(PlanArtifact.read(store)).rejects.toBeInstanceOf(ArtifactParseError);
  });

  test("read throws ArtifactParseError on schema mismatch", async () => {
    const store = createMemoryStore();
    await store.write("plan", JSON.stringify({ schemaVersion: 2, title: "x", steps: [] }));
    await expect(PlanArtifact.read(store)).rejects.toBeInstanceOf(ArtifactParseError);
  });

  test("exists reflects store state", async () => {
    const store = createMemoryStore();
    expect(await PlanArtifact.exists(store)).toBe(false);
    await PlanArtifact.write(store, { schemaVersion: 1, title: "x", steps: [] });
    expect(await PlanArtifact.exists(store)).toBe(true);
  });
});
