/**
 * Collapse a freeform value (package name, file path) into a safe slug for
 * git refs, filesystem paths, and URL fragments: lowercase alphanum,
 * separators as `-`, trimmed of leading/trailing dashes.
 *
 * Handles scoped package names like `@loti/cli` → `loti-cli` (the old regex
 * left a leading dash, producing invalid refs).
 */
export function slugify(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
}
