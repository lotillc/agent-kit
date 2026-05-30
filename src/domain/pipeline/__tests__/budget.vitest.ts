import { describe, expect, test } from "vitest";

import { createCostBudget } from "../budget.js";

describe("createCostBudget", () => {
  test("starts with spentUsd=0 and is not exceeded", () => {
    const b = createCostBudget({ limitUsd: 10 });
    expect(b.spentUsd).toBe(0);
    expect(b.isExceeded()).toBe(false);
  });

  test("record accumulates spend", () => {
    const b = createCostBudget({ limitUsd: 10 });
    b.record(3);
    b.record(2.5);
    expect(b.spentUsd).toBe(5.5);
    expect(b.isExceeded()).toBe(false);
  });

  test("isExceeded returns true when spend exceeds limit", () => {
    const b = createCostBudget({ limitUsd: 10 });
    b.record(10.01);
    expect(b.isExceeded()).toBe(true);
  });

  test("isExceeded is false at exactly the limit", () => {
    const b = createCostBudget({ limitUsd: 10 });
    b.record(10);
    expect(b.isExceeded()).toBe(false);
  });

  test("rejects negative limit", () => {
    expect(() => createCostBudget({ limitUsd: -1 })).toThrow(TypeError);
  });

  test("rejects NaN / Infinity limit", () => {
    expect(() => createCostBudget({ limitUsd: Number.NaN })).toThrow();
    expect(() => createCostBudget({ limitUsd: Number.POSITIVE_INFINITY })).toThrow();
  });

  test("record rejects negative", () => {
    const b = createCostBudget({ limitUsd: 10 });
    expect(() => b.record(-1)).toThrow(TypeError);
  });

  test("record rejects NaN", () => {
    const b = createCostBudget({ limitUsd: 10 });
    expect(() => b.record(Number.NaN)).toThrow();
  });

  test("zero limit is accepted; any spend immediately exceeds", () => {
    const b = createCostBudget({ limitUsd: 0 });
    expect(b.isExceeded()).toBe(false);
    b.record(0.0001);
    expect(b.isExceeded()).toBe(true);
  });

  test("accumulating fractional spends does not trip the budget via IEEE-754 drift", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in raw IEEE-754. Without rounding this
    // would trip isExceeded() at limitUsd=0.3 despite an exact total of 0.3.
    const b = createCostBudget({ limitUsd: 0.3 });
    b.record(0.1);
    b.record(0.1);
    b.record(0.1);
    expect(b.spentUsd).toBe(0.3);
    expect(b.isExceeded()).toBe(false);
  });
});
