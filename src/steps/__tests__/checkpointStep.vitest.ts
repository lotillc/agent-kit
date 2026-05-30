import { describe, expect, test } from "vitest";

import type { ArtifactStore } from "../../ports/ArtifactStore.js";
import { makeCheckpoint } from "../checkpointStep.js";

const memoryStore = (): ArtifactStore => {
  const map = new Map<string, string>();
  return {
    read: async (k) => map.get(k) ?? null,
    write: async (k, v) => {
      map.set(k, v);
    },
    exists: async (k) => map.has(k),
    delete: async (k) => {
      map.delete(k);
    },
  };
};

interface Bag extends Record<string, unknown> {
  phase: string;
  cost: number;
  unrelated?: boolean;
}

describe("makeCheckpoint", () => {
  test("save + load round-trip", async () => {
    const store = memoryStore();
    const cp = makeCheckpoint<Bag>({ store, key: "k" });
    await cp.save({ phase: "plan", cost: 1.23 });
    const restored = await cp.load();
    expect(restored).toEqual({ phase: "plan", cost: 1.23 });
  });

  test("load returns null when key absent", async () => {
    const cp = makeCheckpoint<Bag>({ store: memoryStore(), key: "missing" });
    expect(await cp.load()).toBeNull();
  });

  test("exists reflects store state", async () => {
    const store = memoryStore();
    const cp = makeCheckpoint<Bag>({ store, key: "k" });
    expect(await cp.exists()).toBe(false);
    await cp.save({ phase: "a", cost: 0 });
    expect(await cp.exists()).toBe(true);
  });

  test("fields option serializes only the chosen keys", async () => {
    const store = memoryStore();
    const cp = makeCheckpoint<Bag>({ store, key: "k", fields: ["phase"] });
    await cp.save({ phase: "plan", cost: 5, unrelated: true });
    const raw = await store.read("k");
    expect(JSON.parse(raw!)).toEqual({ phase: "plan" });
  });

  test("load returns null on malformed JSON", async () => {
    const store = memoryStore();
    await store.write("k", "not json");
    const cp = makeCheckpoint<Bag>({ store, key: "k" });
    expect(await cp.load()).toBeNull();
  });
});
