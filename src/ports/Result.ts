/**
 * Discriminated-union result type for structured outcomes that callers branch on.
 *
 * Use throw for exceptional errors (spawn failure, timeout, schema violation).
 * Use Result for structured outcomes where both arms are first-class paths
 * (e.g. diff ok vs disallowed, applyFindings blocked vs downgraded).
 *
 * See ADR-0044.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is { ok: true; value: T } => result.ok;

export const isErr = <T, E>(result: Result<T, E>): result is { ok: false; error: E } => !result.ok;
