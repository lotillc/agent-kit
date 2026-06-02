import { describe, expect, test } from "vitest";

import {
  extractSuspectedBugRationale,
  SUSPECTED_BUG_MARKER,
} from "../prompts/suspectedBugMarker.js";

describe("extractSuspectedBugRationale", () => {
  test("extracts the reason from a trailing marker", () => {
    expect(
      extractSuspectedBugRationale("returns [] for null input (suspected bug: throws TypeError)"),
    ).toBe("throws TypeError");
  });

  test("is case-insensitive", () => {
    expect(extractSuspectedBugRationale("does a thing (SUSPECTED BUG: wrong sign)")).toBe(
      "wrong sign",
    );
  });

  test("trims surrounding whitespace in the reason", () => {
    expect(extractSuspectedBugRationale("x (suspected bug:   off-by-one   )")).toBe("off-by-one");
  });

  test("captures reasons containing internal parentheses", () => {
    expect(
      extractSuspectedBugRationale("y (suspected bug: rejects (async) instead of returning true)"),
    ).toBe("rejects (async) instead of returning true");
  });

  test("returns null when the marker is not trailing", () => {
    // A mid-name mention must not be treated as a declaration.
    expect(
      extractSuspectedBugRationale("(suspected bug: foo) is what this test is NOT about"),
    ).toBeNull();
  });

  test("returns null for an unmarked name", () => {
    expect(
      extractSuspectedBugRationale(
        "returns true when an unexpected error is thrown (safe default)",
      ),
    ).toBeNull();
  });

  test("returns null for an empty reason", () => {
    expect(extractSuspectedBugRationale("z (suspected bug:   )")).toBeNull();
  });

  test("SUSPECTED_BUG_MARKER matches a trailing marker and not a bare parenthetical", () => {
    expect(SUSPECTED_BUG_MARKER.test("a (suspected bug: x)")).toBe(true);
    expect(SUSPECTED_BUG_MARKER.test("a (safe default)")).toBe(false);
  });
});
