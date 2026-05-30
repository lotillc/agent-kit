/**
 * Prompt-version stamping helpers (ADR-0027). Each prompt in the toolkit has
 * its own version string; analysts slicing run records by prompt variant rely
 * on seeing that version stamp in every artifact.
 *
 * Pure — attaches a `promptVersion` field (or consumer-chosen key) to any
 * object.
 */

export const stampPromptVersion = <
  T extends Record<string, unknown>,
  K extends string = "promptVersion",
>(
  artifact: T,
  version: string,
  fieldName: K = "promptVersion" as K,
): T & Record<K, string> => ({ ...artifact, [fieldName]: version }) as T & Record<K, string>;

/**
 * Compose a prompt-version string from a stable identifier + an optional
 * iteration suffix. Convention: `"<id>@v<n>"`.
 */
export const formatPromptVersion = (id: string, v: number | string): string => `${id}@v${v}`;
