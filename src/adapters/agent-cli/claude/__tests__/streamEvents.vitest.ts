import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { formatStreamEvent, parseStreamEventLine, type StreamEvent } from "../streamEvents.js";

const fixturesRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../__fixtures__/stream-json",
);

const readFixture = (name: string): string[] =>
  readFileSync(resolve(fixturesRoot, name), "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0);

describe("parseStreamEventLine", () => {
  test("parses all lines of simple-success fixture", () => {
    const events = readFixture("simple-success.jsonl").map(parseStreamEventLine);
    expect(events.every((e) => e !== null)).toBe(true);
    expect(events[0]?.type).toBe("system");
    expect(events.at(-1)?.type).toBe("result");
  });

  test("returns null for non-JSON line", () => {
    expect(parseStreamEventLine("pnpm install completed")).toBeNull();
  });

  // `subtype` is the only unambiguous turn-cap signal; `num_turns` at the cap isn't.
  test("surfaces the result subtype on a max-turns stop", () => {
    const events = readFixture("max-turns.jsonl").map(parseStreamEventLine);
    const result = events.at(-1);
    expect(result?.type).toBe("result");
    expect(result?.subtype).toBe("error_max_turns");
    expect(result?.is_error).toBe(true);
    expect(result?.num_turns).toBe(60);
  });

  test("returns null for JSON without `type` field", () => {
    expect(parseStreamEventLine('{"foo": "bar"}')).toBeNull();
  });

  test("returns null for empty line", () => {
    expect(parseStreamEventLine("")).toBeNull();
  });

  test("returns null for JSON `null`", () => {
    expect(parseStreamEventLine("null")).toBeNull();
  });

  test("extracts session_id from system events", () => {
    const event = parseStreamEventLine('{"type":"system","session_id":"sess_abc"}');
    expect(event?.session_id).toBe("sess_abc");
  });

  test("parses result event fields", () => {
    const lines = readFixture("simple-success.jsonl");
    const resultLine = lines.at(-1)!;
    const event = parseStreamEventLine(resultLine);
    expect(event?.type).toBe("result");
    expect(event?.total_cost_usd).toBe(0.0234);
    expect(event?.duration_ms).toBe(12345);
    expect(event?.num_turns).toBe(2);
    expect(event?.is_error).toBe(false);
  });
});

describe("formatStreamEvent — structure, not prose (ADR-0014)", () => {
  test("formats system event with session tag", () => {
    const ev: StreamEvent = { type: "system", session_id: "sess_123" };
    expect(formatStreamEvent(ev)).toBe("[claude:session] sess_123");
  });

  test("formats assistant text block", () => {
    const ev: StreamEvent = {
      type: "assistant",
      message: { id: "m1", content: [{ type: "text", text: "Hello world." }] },
    };
    expect(formatStreamEvent(ev)).toMatch(/^\[claude\] Hello world\./);
  });

  test("formats assistant tool_use block with detail", () => {
    const ev: StreamEvent = {
      type: "assistant",
      message: {
        id: "m1",
        content: [{ type: "tool_use", name: "Read", input: { file_path: "/foo.ts" } }],
      },
    };
    expect(formatStreamEvent(ev)).toBe("[claude:tool] Read /foo.ts");
  });

  test("formats assistant thinking block", () => {
    const ev: StreamEvent = {
      type: "assistant",
      message: { id: "m1", content: [{ type: "thinking", text: "Hmm." }] },
    };
    expect(formatStreamEvent(ev)).toBe("[claude:thinking] Hmm.");
  });

  test("formats result event with structural fields", () => {
    const ev: StreamEvent = {
      type: "result",
      total_cost_usd: 0.05,
      num_turns: 3,
      is_error: false,
    };
    expect(formatStreamEvent(ev)).toBe("[claude:done] turns=3 cost=$0.0500 error=no");
  });

  test("returns null for events with no formattable content", () => {
    expect(formatStreamEvent({ type: "assistant", message: { content: [] } })).toBeNull();
  });

  test("returns null for unknown event types", () => {
    expect(formatStreamEvent({ type: "completely_new" })).toBeNull();
  });

  test("truncates very long text blocks", () => {
    const longText = "x".repeat(1000);
    const ev: StreamEvent = {
      type: "assistant",
      message: { id: "m1", content: [{ type: "text", text: longText }] },
    };
    const formatted = formatStreamEvent(ev);
    expect(formatted!.length).toBeLessThan(450);
    expect(formatted).toContain("…");
  });
});
