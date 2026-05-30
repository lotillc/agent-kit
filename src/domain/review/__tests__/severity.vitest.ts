import { describe, expect, test } from "vitest";

import { compareSeverity, normalizeSeverity, SEVERITY_ORDER } from "../severity.js";

describe("compareSeverity", () => {
  test("critical beats everything else", () => {
    for (const sev of SEVERITY_ORDER.slice(1)) {
      expect(compareSeverity("critical", sev)).toBeLessThan(0);
    }
  });

  test("info loses to everything else", () => {
    for (const sev of SEVERITY_ORDER.slice(0, -1)) {
      expect(compareSeverity(sev, "info")).toBeLessThan(0);
    }
  });

  test("equal severities compare to 0", () => {
    expect(compareSeverity("high", "high")).toBe(0);
  });

  test("sorts an array most-urgent-first", () => {
    const xs: (typeof SEVERITY_ORDER)[number][] = ["low", "critical", "medium", "info", "high"];
    xs.sort(compareSeverity);
    expect(xs).toEqual(["critical", "high", "medium", "low", "info"]);
  });
});

describe("normalizeSeverity", () => {
  test.each([
    ["CRITICAL", "critical"],
    ["  High ", "high"],
    ["MEDIUM", "medium"],
    ["low", "low"],
    ["info", "info"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeSeverity(raw)).toBe(expected);
  });

  test("unknown strings fall back to low", () => {
    expect(normalizeSeverity("blocker")).toBe("low");
  });
});
