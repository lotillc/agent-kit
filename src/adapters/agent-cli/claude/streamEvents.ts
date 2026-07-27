/**
 * Shape of a stream-json event emitted by the Claude Code CLI when invoked
 * with `-p --output-format stream-json --verbose`.
 *
 * We only declare the fields we actually read; extras pass through unchanged.
 * Snapshot fixtures live at `src/__fixtures__/stream-json/`
 * and are updated alongside claude-code bumps (ADR-0012).
 */
export interface StreamContentBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
}

export interface StreamModelTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface StreamAssistantMessage {
  /** Anthropic message id — stable across partial-streaming emits within one turn. */
  id?: string;
  content?: StreamContentBlock[];
  [key: string]: unknown;
}

export interface StreamEvent {
  type: string;
  session_id?: string;
  message?: StreamAssistantMessage;
  result?: string;
  /**
   * On a `result` event: `"success"`, or one of `"error_max_turns"`,
   * `"error_max_budget_usd"`, `"error_max_structured_output_retries"`,
   * `"error_during_execution"`.
   */
  subtype?: string;
  is_error?: boolean;
  error?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  modelUsage?: Record<string, StreamModelTokenUsage>;
}

/**
 * Try to parse a single line of stream-json output. Returns `null` for lines
 * that are not valid JSON (pnpm progress, partial output, etc.).
 *
 * Silent on failure — callers decide whether to log the raw line.
 */
export const parseStreamEventLine = (line: string): StreamEvent | null => {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (parsed === null || typeof parsed !== "object" || !("type" in parsed)) {
      return null;
    }
    return parsed as StreamEvent;
  } catch {
    return null;
  }
};

/**
 * Format a stream event into a single-line log string. Consumers pipe this to
 * stderr or to a logger; events unknown to the formatter render as
 * `[claude:<type>]`.
 *
 * Kept small deliberately — prompt + output churn is already the dominant log
 * surface; this function stays terse.
 */
export const formatStreamEvent = (event: StreamEvent): string | null => {
  if (event.type === "system" && event.session_id) {
    return `[claude:session] ${event.session_id}`;
  }
  if (event.type === "assistant") {
    const lines: string[] = [];
    for (const block of event.message?.content ?? []) {
      if (block.type === "text" && block.text) {
        lines.push(`[claude] ${truncate(block.text, 400)}`);
      } else if (block.type === "tool_use" && block.name) {
        const detail = summarizeToolInput(block);
        lines.push(`[claude:tool] ${block.name}${detail ? ` ${detail}` : ""}`);
      } else if (block.type === "thinking" && block.text) {
        lines.push(`[claude:thinking] ${truncate(block.text, 200)}`);
      }
    }
    return lines.length === 0 ? null : lines.join("\n");
  }
  if (event.type === "result") {
    const cost = event.total_cost_usd?.toFixed(4) ?? "?";
    const turns = event.num_turns ?? "?";
    return `[claude:done] turns=${turns} cost=$${cost} error=${event.is_error ? "yes" : "no"}`;
  }
  return null;
};

const summarizeToolInput = (block: StreamContentBlock): string => {
  if (!block.input) return "";
  const fields = ["file_path", "command", "pattern", "path"];
  for (const f of fields) {
    const v = block.input[f];
    if (typeof v === "string") return truncate(v, 120);
  }
  return "";
};

const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);
