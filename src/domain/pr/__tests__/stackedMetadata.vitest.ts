import { describe, expect, test } from "vitest";

import { embedMetadata, parseMetadata } from "../stackedMetadata.js";

interface Meta {
  sourcePr: number;
  at: string;
}

describe("embedMetadata", () => {
  test("appends an HTML-comment marker when no prior tag exists", () => {
    const body = embedMetadata<Meta>({
      body: "Original body",
      tagName: "agent-metadata",
      metadata: { sourcePr: 42, at: "2026-04-20" },
    });
    expect(body).toContain("Original body");
    expect(body).toContain('<!-- agent-metadata {"sourcePr":42,"at":"2026-04-20"} -->');
  });

  test("survives a metadata value containing the comment terminator", () => {
    const body = embedMetadata({
      body: "B",
      tagName: "t",
      metadata: { note: "danger --> here" },
    });
    // The payload's `>` is escaped, so the only `-->` is the real marker close.
    expect(body).not.toContain("danger --> here");
    const parsed = parseMetadata<{ note: string }>({ body, tagName: "t" });
    expect(parsed).toEqual({ note: "danger --> here" });
  });

  test("replaces an existing tag rather than appending a second one", () => {
    const first = embedMetadata<Meta>({
      body: "Body",
      tagName: "t",
      metadata: { sourcePr: 1, at: "x" },
    });
    const second = embedMetadata<Meta>({
      body: first,
      tagName: "t",
      metadata: { sourcePr: 99, at: "y" },
    });
    const matches = second.match(/<!-- t /g);
    expect(matches).toHaveLength(1);
    expect(second).toContain('"sourcePr":99');
  });
});

describe("parseMetadata", () => {
  test("round-trips with embedMetadata", () => {
    const body = embedMetadata<Meta>({
      body: "hi",
      tagName: "t",
      metadata: { sourcePr: 10, at: "z" },
    });
    expect(parseMetadata<Meta>({ body, tagName: "t" })).toEqual({ sourcePr: 10, at: "z" });
  });

  test("returns null when tag is absent", () => {
    expect(parseMetadata<Meta>({ body: "no metadata here", tagName: "t" })).toBeNull();
  });

  test("returns null when payload is malformed JSON", () => {
    expect(parseMetadata<Meta>({ body: "<!-- t {not-json} -->", tagName: "t" })).toBeNull();
  });

  test("ignores a different tag name", () => {
    const body = embedMetadata<Meta>({
      body: "x",
      tagName: "other",
      metadata: { sourcePr: 1, at: "x" },
    });
    expect(parseMetadata<Meta>({ body, tagName: "t" })).toBeNull();
  });

  test("parses a legacy `DO NOT EDIT` marker format", () => {
    // Existing stacked-PR threads embed metadata as
    //   <!-- agent-metadata DO NOT EDIT {…} -->
    // The new writer drops the DO NOT EDIT token, but the parser must still
    // accept the legacy form during migration so historical threads round-trip.
    const legacyBody = `
## existing PR body
<!-- agent-metadata DO NOT EDIT {"sourcePr":42,"at":"2026-01-01"} -->
`;
    const meta = parseMetadata<Meta>({ body: legacyBody, tagName: "agent-metadata" });
    expect(meta).toEqual({ sourcePr: 42, at: "2026-01-01" });
  });

  test("rewriting a legacy marker normalizes it to the no-prefix form", () => {
    // embedMetadata's pattern.test() should match the legacy marker too, so
    // the replace path runs (rather than appending a second marker).
    const legacyBody = '<!-- agent-metadata DO NOT EDIT {"sourcePr":1,"at":"x"} -->\n';
    const rewritten = embedMetadata<Meta>({
      body: legacyBody,
      tagName: "agent-metadata",
      metadata: { sourcePr: 2, at: "y" },
    });
    expect(rewritten).not.toContain("DO NOT EDIT");
    expect(rewritten).toContain('<!-- agent-metadata {"sourcePr":2,"at":"y"} -->');
    // No duplicate marker.
    const markerCount = (rewritten.match(/<!-- agent-metadata /g) ?? []).length;
    expect(markerCount).toBe(1);
  });
});
