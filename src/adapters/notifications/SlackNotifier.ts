import type { Notification, Notifier } from "../../ports/Notifier.js";

/**
 * Slack webhook notifier.
 * Silent on failure: if the webhook URL is empty or the POST
 * fails, the notification is dropped without throwing — matches a design
 * where notifications must never block the pipeline.
 */

export interface SlackNotifierOptions {
  webhookUrl: string;
  /** Inject a custom fetch implementation for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms. Default 5000. */
  timeoutMs?: number;
  /**
   * Called on transport failures (for observability). The notifier guarantees
   * `onError` is invoked at most once per `notify()` call, and any throw from
   * `onError` itself is swallowed so the pipeline never sees a notification
   * failure.
   */
  onError?: (err: unknown) => void;
  /**
   * Render `body` and field text as raw Slack markdown. Default `false`: `&`,
   * `<`, `>` are escaped so untrusted content (PR titles, findings) cannot
   * inject mentions (`<!channel>`), links, or user pings.
   */
  allowRawMarkdown?: boolean;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/** Escape the three characters Slack uses to parse mrkdwn mentions/links. */
const escapeMrkdwn = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type SlackBlock =
  | {
      type: "header";
      text: { type: "plain_text"; text: string };
    }
  | {
      type: "section";
      fields?: Array<{ type: "mrkdwn"; text: string }>;
      text?: { type: "mrkdwn"; text: string };
    };

interface SlackMessage {
  blocks: SlackBlock[];
}

export class SlackNotifier implements Notifier {
  constructor(private readonly opts: SlackNotifierOptions) {}

  async notify(message: Notification): Promise<void> {
    if (!this.opts.webhookUrl) return;
    try {
      const body = JSON.stringify(
        buildSlackPayload(message, { escape: this.opts.allowRawMarkdown !== true }),
      );
      const fetchImpl = this.opts.fetchImpl ?? fetch;
      const res = await fetchImpl(this.opts.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      // Drain the response body in both branches — undici otherwise holds the
      // connection open until GC for unconsumed bodies, which compounds under
      // repeated webhook failures (revoked URL returning 4xx, Slack 5xx, etc.)
      // and exhausts the dispatcher's keep-alive pool.
      const status = res.status;
      const ok = res.ok;
      await res.body?.cancel();
      if (!ok) {
        throw new Error(`Slack webhook returned ${status}`);
      }
    } catch (err) {
      try {
        this.opts.onError?.(err);
      } catch {
        // `onError` is observability-only; never let it surface a failure.
      }
    }
  }
}

export const buildSlackPayload = (
  message: Notification,
  opts: { escape?: boolean } = {},
): SlackMessage => {
  const esc = opts.escape === false ? (s: string) => s : escapeMrkdwn;
  const icon =
    message.severity === "error"
      ? ":red_circle:"
      : message.severity === "warning"
        ? ":warning:"
        : ":information_source:";
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${icon} ${message.title}` },
    },
  ];
  if (message.body) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: esc(message.body) } });
  }
  if (message.fields && message.fields.length > 0) {
    // Slack section blocks allow at most 10 fields. Pass more and the API
    // returns a non-2xx, which our silent-fail notifier would drop entirely.
    // Cap to preserve the most important rows (assumed first) so high-detail
    // alerts at least partially render.
    const SLACK_FIELDS_MAX = 10;
    const fields = message.fields.slice(0, SLACK_FIELDS_MAX).map((f) => ({
      type: "mrkdwn" as const,
      text: `*${esc(f.label)}:*\n${esc(f.value)}`,
    }));
    blocks.push({ type: "section", fields });
  }
  return { blocks };
};
