import { describe, expect, test } from "vitest";

import { err, isErr, isOk, ok, type Result } from "../Result.js";

describe("Result", () => {
  test("ok constructs the success arm and narrows via isOk", () => {
    const r: Result<number, string> = ok(42);
    expect(r.ok).toBe(true);
    if (isOk(r)) {
      expect(r.value).toBe(42);
    }
  });

  test("err constructs the failure arm and narrows via isErr", () => {
    const r: Result<number, string> = err("bad");
    expect(r.ok).toBe(false);
    if (isErr(r)) {
      expect(r.error).toBe("bad");
    }
  });
});
