export interface RedactionOptions {
  /** Literal secret values to mask (e.g. a resolved API key from the caller). */
  secrets?: readonly string[];
}

const PLACEHOLDER = "[REDACTED]";

// Common credential shapes. Conservative on purpose — each pattern targets a
// recognizable token prefix/format so ordinary prose is not mangled.
const PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g, // Anthropic API keys
  /\bgh[posru]_[A-Za-z0-9]{16,}\b/g, // GitHub tokens: ghp_/gho_/ghs_/ghr_/ghu_
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, // GitHub fine-grained PATs
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key IDs
  /(?<=[Bb]earer )[A-Za-z0-9._~+/-]{12,}=*/g, // Bearer <token>
  /(?<=x-access-token:)\s*[^\s@/]+/gi, // x-access-token:<token> (optional space)
];

const MIN_LITERAL_LENGTH = 6;

/**
 * Scrub credentials from a log string. Masks any caller-supplied literal
 * `secrets` plus common token shapes (Anthropic, GitHub, AWS, bearer,
 * x-access-token). Pure; safe to call on every log line (ADR-0021).
 */
export const redactSecrets = (input: string, opts: RedactionOptions = {}): string => {
  let out = input;
  for (const secret of opts.secrets ?? []) {
    if (secret && secret.length >= MIN_LITERAL_LENGTH) {
      out = out.split(secret).join(PLACEHOLDER);
    }
  }
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, PLACEHOLDER);
  }
  return out;
};
