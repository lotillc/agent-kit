import { afterEach, describe, expect, test, vi } from "vitest";

import { NonInteractiveStdinError, promptApproval } from "../interactiveApprovalStep.js";

describe("promptApproval", () => {
  test("yes returns approved", async () => {
    const readLine = vi.fn().mockResolvedValue("y");
    const write = vi.fn();
    const result = await promptApproval({ phase: "plan", summary: "s", readLine, write });
    expect(result).toEqual({ decision: "approved" });
  });

  test("no returns rejected", async () => {
    const readLine = vi.fn().mockResolvedValue("no");
    const result = await promptApproval({
      phase: "spec",
      summary: "",
      readLine,
      write: () => undefined,
    });
    expect(result.decision).toBe("rejected");
  });

  test("r returns revise with feedback", async () => {
    const readLine = vi.fn().mockResolvedValueOnce("r").mockResolvedValueOnce("  add more tests  ");
    const result = await promptApproval({
      phase: "review",
      summary: "",
      readLine,
      write: () => undefined,
    });
    expect(result).toEqual({ decision: "revise", feedback: "add more tests" });
  });

  test("reprompts until a valid answer is given", async () => {
    const readLine = vi.fn().mockResolvedValueOnce("maybe").mockResolvedValueOnce("yes");
    const write = vi.fn();
    const result = await promptApproval({ phase: "x", summary: "", readLine, write });
    expect(result.decision).toBe("approved");
    expect(readLine).toHaveBeenCalledTimes(2);
    expect(write.mock.calls.some(([m]) => m.includes("unrecognized"))).toBe(true);
  });
});

describe("promptApproval — non-interactive stdin guard", () => {
  const originalIsTTY = process.stdin.isTTY;
  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
  });

  test("throws NonInteractiveStdinError when default readLine runs without a TTY", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    await expect(promptApproval({ phase: "x", summary: "" })).rejects.toBeInstanceOf(
      NonInteractiveStdinError,
    );
  });

  test("does NOT throw when a custom readLine is supplied (caller owns env)", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const readLine = vi.fn().mockResolvedValue("y");
    const result = await promptApproval({
      phase: "x",
      summary: "",
      readLine,
      write: () => undefined,
    });
    expect(result.decision).toBe("approved");
  });
});
