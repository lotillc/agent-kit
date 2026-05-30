import { describe, expect, test } from "vitest";

import { createPerKeyQueue, prQueueKey } from "../perKeyQueue.js";

const defer = <T>(): { promise: Promise<T>; resolve: (v: T) => void } => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("createPerKeyQueue", () => {
  test("serializes calls for the same key", async () => {
    const q = createPerKeyQueue();
    const callOrder: number[] = [];
    const d1 = defer<number>();
    const p1 = q.enqueue("k", () =>
      d1.promise.then((v) => {
        callOrder.push(v);
        return v;
      }),
    );
    const p2 = q.enqueue("k", async () => {
      callOrder.push(2);
      return 2;
    });
    d1.resolve(1);
    const results = await Promise.all([p1, p2]);
    expect(results).toEqual([1, 2]);
    expect(callOrder).toEqual([1, 2]);
  });

  test("runs different keys concurrently", async () => {
    const q = createPerKeyQueue();
    const d1 = defer<number>();
    const d2 = defer<number>();
    const p1 = q.enqueue("a", () => d1.promise);
    const p2 = q.enqueue("b", () => d2.promise);
    // Resolve in reverse order — proves b didn't wait on a.
    d2.resolve(2);
    d1.resolve(1);
    expect(await Promise.all([p1, p2])).toEqual([1, 2]);
  });

  test("recovers after a failing fn so later fns still run", async () => {
    const q = createPerKeyQueue();
    await expect(
      q.enqueue("k", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const later = await q.enqueue("k", async () => 42);
    expect(later).toBe(42);
  });

  test("isQueued reflects in-flight work", async () => {
    const q = createPerKeyQueue();
    expect(q.isQueued("k")).toBe(false);
    const d = defer<void>();
    const pending = q.enqueue("k", () => d.promise);
    expect(q.isQueued("k")).toBe(true);
    d.resolve();
    await pending;
    await Promise.resolve(); // let finally fire
    expect(q.isQueued("k")).toBe(false);
  });

  test("activeKeyCount tracks distinct keys with work, drops back to 0 after completion", async () => {
    const q = createPerKeyQueue();
    const d1 = defer<void>();
    const d2 = defer<void>();
    const p1 = q.enqueue("a", () => d1.promise);
    const p2 = q.enqueue("b", () => d2.promise);
    expect(q.activeKeyCount()).toBe(2);
    d1.resolve();
    d2.resolve();
    await Promise.all([p1, p2]);
    await Promise.resolve();
    expect(q.activeKeyCount()).toBe(0);
  });
});

describe("prQueueKey", () => {
  test("composes owner/repo#prNumber", () => {
    expect(prQueueKey("acme", "widgets", 123)).toBe("acme/widgets#123");
  });
});
