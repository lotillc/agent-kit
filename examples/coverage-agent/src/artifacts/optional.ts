import { existsSync, readFileSync } from "node:fs";

/**
 * Read a JSON artifact if it exists. Used by pipeline / summary where a
 * missing or malformed file just means "that stage didn't run yet" rather
 * than an error. Returns undefined on read or parse failure.
 */
export function readOptionalJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
