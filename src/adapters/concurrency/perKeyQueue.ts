/**
 * In-memory per-key serialization (explicitly single-instance).
 * Consumers that need distributed scheduling should swap in
 * a redis / postgres implementation behind the same interface.
 *
 * Chain of responsibility: each `enqueue(key, fn)` call attaches `fn` to the
 * tail of a per-key Promise chain. When a chain settles (success OR failure)
 * the map entry is deleted so memory doesn't leak across keys.
 */

export interface PerKeyQueue {
  /** Chain `fn` onto `key`'s queue. Resolves after `fn` runs. */
  enqueue<T>(key: string, fn: () => Promise<T>): Promise<T>;
  /** `true` iff there is active / pending work for `key`. */
  isQueued(key: string): boolean;
  /** Number of keys with in-flight work; useful for tests. */
  activeKeyCount(): number;
}

export const createPerKeyQueue = (): PerKeyQueue => {
  const tails = new Map<string, Promise<unknown>>();

  return {
    enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const prior = tails.get(key) ?? Promise.resolve();
      const next = prior.then(fn, fn);
      tails.set(key, next);
      // Clean up when this specific link finishes, but only if it's still
      // the tail (otherwise a later enqueue has already replaced it).
      // `.catch` silences the rejection on the tracking chain so it does
      // NOT surface as an unhandled rejection — the caller still sees
      // rejections via the returned `next` promise.
      next
        .catch(() => undefined)
        .finally(() => {
          if (tails.get(key) === next) tails.delete(key);
        });
      return next;
    },
    isQueued(key: string): boolean {
      return tails.has(key);
    },
    activeKeyCount(): number {
      return tails.size;
    },
  };
};

/**
 * Format a PR queue key from owner/repo/prNumber. Convenience helper for the
 * "serialize follow-ups on the same PR" use case.
 */
export const prQueueKey = (owner: string, repo: string, prNumber: number): string =>
  `${owner}/${repo}#${prNumber}`;
