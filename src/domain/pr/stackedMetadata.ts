/**
 * Embed structured metadata inside a PR body as an invisible HTML comment.
 *
 * Marker shape: `<!-- <tagName> {...json...} -->`. Agent-kit is generic over
 * the tag so each consumer picks its own (`agent-metadata`,
 * `my-coverage-metadata`, etc.).
 *
 * Both helpers are pure — no octokit / no network.
 */

export interface EmbedMetadataInput<M> {
  body: string;
  tagName: string;
  metadata: M;
}

export interface ParseMetadataInput {
  body: string;
  tagName: string;
}

/**
 * Append (or replace) a metadata comment on a PR body. If a comment with the
 * same tag already exists, it is replaced; otherwise appended with a
 * separating blank line.
 */
export const embedMetadata = <M>({ body, tagName, metadata }: EmbedMetadataInput<M>): string => {
  // Escape `>` so a value containing `-->` can't terminate the HTML comment
  // early. Every `>` in JSON output lives inside a string, so this is
  // reversible — `JSON.parse` turns the `>` escape back into `>`.
  const payload = JSON.stringify(metadata).replace(/>/g, "\\u003e");
  const marker = `<!-- ${tagName} ${payload} -->`;
  const existing = findMarker(body, tagName);
  if (existing) {
    return body.slice(0, existing.start) + marker + body.slice(existing.end);
  }
  const trimmed = body.endsWith("\n") ? body.slice(0, -1) : body;
  return `${trimmed}\n\n${marker}\n`;
};

/**
 * Extract the JSON payload of a metadata comment matching `tagName`.
 * Returns `null` if the comment is missing or its payload does not parse.
 */
export const parseMetadata = <M>({ body, tagName }: ParseMetadataInput): M | null => {
  const existing = findMarker(body, tagName);
  if (!existing) return null;
  try {
    return JSON.parse(existing.payload) as M;
  } catch {
    return null;
  }
};

interface FoundMarker {
  /** Inclusive start of `<!--`. */
  start: number;
  /** Exclusive end after `-->`. */
  end: number;
  /** JSON payload substring (still text, not parsed). */
  payload: string;
}

/**
 * Locate the first metadata marker for `tagName` in `body`, or `null` if
 * absent. Tolerates intermediate non-`{` tokens between the tag and payload
 * (e.g. a legacy `<!-- agent-metadata DO NOT EDIT {…} -->`).
 *
 * Uses string-search primitives only — no `new RegExp(`...${tagName}...`)`
 * (SAST WS-I011-JAVASCRIPT-00003 flags dynamic regex construction even with
 * escaped input, and there's no behavioral reason to use a regex here).
 */
const findMarker = (body: string, tagName: string): FoundMarker | null => {
  const opening = `<!-- ${tagName}`;
  let searchFrom = 0;
  while (searchFrom < body.length) {
    const idx = body.indexOf(opening, searchFrom);
    if (idx === -1) return null;
    // After the tag we require whitespace so `tagName: "t"` doesn't match
    // `<!-- twin {…} -->`. ASCII space=32, tab=9, LF=10, CR=13.
    const afterCode = body.charCodeAt(idx + opening.length);
    const tagBoundary = afterCode === 32 || afterCode === 9 || afterCode === 10 || afterCode === 13;
    if (!tagBoundary) {
      searchFrom = idx + 1;
      continue;
    }
    const closeIdx = body.indexOf("-->", idx + opening.length);
    if (closeIdx === -1) return null;
    const inner = body.slice(idx + opening.length, closeIdx);
    const jsonStart = inner.indexOf("{");
    const jsonEnd = inner.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd <= jsonStart) return null;
    return {
      start: idx,
      end: closeIdx + 3,
      payload: inner.slice(jsonStart, jsonEnd + 1),
    };
  }
  return null;
};
